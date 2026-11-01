import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { jaccard } from '@/duplication/token-similarity.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { readTextIfPresent } from './fs-io.js';
import { descriptionLength } from './lint/fields.js';
import { agentNameOf, agentRoots, skillRoots, SKILL_FILE, type SkillPathContext } from './paths.js';
import { meetsThreshold } from './thresholds.js';

export type ArtifactKind = 'skill' | 'agent';

export type ArtifactScope = 'managed' | 'cli' | 'project' | 'user' | 'plugin';

export const SCOPE_PRECEDENCE: readonly ArtifactScope[] = ['user', 'project'];

export const AGENT_SCOPE_PRECEDENCE: readonly ArtifactScope[] = [
  'managed',
  'cli',
  'project',
  'user',
  'plugin',
];

export interface InstalledArtifact {
  kind: ArtifactKind;
  name: string;
  description: string;
  path: string;
  scope: ArtifactScope;
  tools?: string[];
}

export interface OverlapCandidate {
  kind: ArtifactKind;
  name: string;
  text: string;
  scope: ArtifactScope;
}

export interface OverlapCollision {
  candidate: string;
  existing: string;
  existing_path: string;
  score: number;
  subset?: boolean;
}

export interface ShadowSide {
  scope: ArtifactScope;
  path: string | null;
}

export interface NameShadowing {
  name: string;
  shadowing: ShadowSide;
  shadowed: ShadowSide;
}

export interface CatalogBudget {
  total_chars: number;
  budget_chars: number;
  over_budget: boolean;
  at_risk: string[];
  activation_data: boolean;
}

export interface OverlapReport {
  kind: ArtifactKind;
  candidate: string;
  threshold: number;
  scores: Array<{ existing: string; score: number }>;
  collisions: OverlapCollision[];
  shadowing: NameShadowing[];
  budget: CatalogBudget;
}

const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before ' +
    'being below between both but by can could did do does doing down during each few for from ' +
    'further had has have having he her here hers herself him himself his how i if in into is it ' +
    'its itself just me more most my myself no nor not now of off on once only or other our ours ' +
    'ourselves out over own same she should so some such than that the their theirs them ' +
    'themselves then there these they this those through to too under until up very was we were ' +
    'what when where which while who whom why will with would you your yours yourself ' +
    'yourselves use used uses using skill skills'
  ).split(' '),
);

export function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 0 && !STOP_WORDS.has(word)),
  );
}

export function overlapScore(left: string, right: string): number {
  return jaccard(wordSet(left), wordSet(right));
}

export const SUBSET_CONTAINMENT_MIN = 0.8;

export function containment(inner: string, outer: string): number {
  const words = wordSet(inner);
  if (words.size === 0) return 0;
  const outerWords = wordSet(outer);
  let shared = 0;
  for (const word of words) if (outerWords.has(word)) shared += 1;
  return shared / words.size;
}

export interface SubsetCandidate {
  name: string;
  job: string;
  tools: readonly string[];
}

export function findSubsetOverlaps(
  candidate: SubsetCandidate,
  installed: readonly InstalledArtifact[],
  minContainment: number = SUBSET_CONTAINMENT_MIN,
): OverlapCollision[] {
  const overlaps: OverlapCollision[] = [];
  for (const artifact of installed) {
    if (artifact.kind !== 'agent' || artifact.name === candidate.name) continue;
    if (artifact.tools === undefined) continue;
    const theirs = new Set(artifact.tools);
    if (!candidate.tools.every((tool) => theirs.has(tool))) continue;
    const score = containment(candidate.job, artifact.description);
    if (score < minContainment) continue;
    overlaps.push({
      candidate: candidate.name,
      existing: artifact.name,
      existing_path: artifact.path,
      score,
      subset: true,
    });
  }
  return overlaps;
}

export interface ExpertProfile {
  role: string;
  owns: string;
  lens?: string;
}

export interface ExpertCollision {
  role: string;
  owner: string;
  on: 'owns' | 'lens';
  score: number;
}

export function lensFocus(lens: string): string {
  const section = lens.split(/^## What you look for\s*$/mu)[1];
  return section === undefined ? lens : (section.split(/^## /mu)[0] ?? '');
}

function profileCollisions(
  role: ExpertProfile,
  owner: ExpertProfile,
  threshold: number,
): ExpertCollision[] {
  const found: ExpertCollision[] = [];
  const owns = overlapScore(role.owns, owner.owns);
  if (meetsThreshold(owns, threshold)) {
    found.push({ role: role.role, owner: owner.role, on: 'owns', score: owns });
  }
  if (role.lens !== undefined && owner.lens !== undefined) {
    const lens = overlapScore(lensFocus(role.lens), lensFocus(owner.lens));
    if (meetsThreshold(lens, threshold)) {
      found.push({ role: role.role, owner: owner.role, on: 'lens', score: lens });
    }
  }
  return found;
}

export function expertCollisions(
  roster: readonly ExpertProfile[],
  threshold: number,
  candidate?: ExpertProfile,
): ExpertCollision[] {
  if (candidate !== undefined) {
    return roster
      .filter((owner) => owner.role !== candidate.role)
      .flatMap((owner) => profileCollisions(candidate, owner, threshold));
  }
  const found: ExpertCollision[] = [];
  roster.forEach((owner, index) => {
    for (const role of roster.slice(index + 1)) {
      found.push(...profileCollisions(role, owner, threshold));
    }
  });
  return found;
}

export function expertCollisionLine(collision: ExpertCollision): string {
  const what = collision.on === 'owns' ? 'Owns phrase' : 'lens';
  return (
    `The expert ${collision.role} collides with ${collision.owner} on its ${what} ` +
    `(score ${collision.score.toFixed(2)}): ${collision.owner} already owns that question. ` +
    `Give ${collision.role} a question no other role answers, or extend ${collision.owner}.`
  );
}

export function candidateText(purpose: string, triggers: readonly string[]): string {
  return [purpose, ...triggers].join(' ');
}

export function findCollisions(
  candidate: OverlapCandidate,
  installed: readonly InstalledArtifact[],
  threshold: number,
): { scores: Array<{ existing: string; score: number }>; collisions: OverlapCollision[] } {
  const scores: Array<{ existing: string; score: number }> = [];
  const collisions: OverlapCollision[] = [];
  for (const artifact of installed) {
    if (artifact.kind !== candidate.kind || artifact.name === candidate.name) continue;
    const score = overlapScore(candidate.text, artifact.description);
    scores.push({ existing: artifact.name, score });
    if (meetsThreshold(score, threshold)) {
      collisions.push({
        candidate: candidate.name,
        existing: artifact.name,
        existing_path: artifact.path,
        score,
      });
    }
  }
  return { scores, collisions };
}

function outranks(
  left: ArtifactScope,
  right: ArtifactScope,
  precedence: readonly ArtifactScope[],
): boolean {
  return precedence.indexOf(left) < precedence.indexOf(right);
}

export function findNameShadowing(
  candidate: OverlapCandidate,
  installed: readonly InstalledArtifact[],
  precedence: readonly ArtifactScope[] = candidate.kind === 'agent'
    ? AGENT_SCOPE_PRECEDENCE
    : SCOPE_PRECEDENCE,
): NameShadowing[] {
  const shadowing: NameShadowing[] = [];
  for (const artifact of installed) {
    if (
      artifact.kind !== candidate.kind ||
      artifact.name !== candidate.name ||
      artifact.scope === candidate.scope
    ) {
      continue;
    }
    const existing: ShadowSide = { scope: artifact.scope, path: artifact.path };
    const fresh: ShadowSide = { scope: candidate.scope, path: null };
    const existingWins = outranks(artifact.scope, candidate.scope, precedence);
    shadowing.push({
      name: candidate.name,
      shadowing: existingWins ? existing : fresh,
      shadowed: existingWins ? fresh : existing,
    });
  }
  return shadowing;
}

function sideText(side: ShadowSide): string {
  return side.path === null ? `the new ${side.scope} one` : `${side.path} (${side.scope})`;
}

export function shadowingLine(entry: NameShadowing): string {
  const shadowing = sideText(entry.shadowing);
  const shadowed = sideText(entry.shadowed);
  return `The name ${entry.name} is taken in another scope: ${shadowing} would shadow ${shadowed}. Pick another name.`;
}

export function catalogBudget(input: {
  installed: readonly InstalledArtifact[];
  candidate?: { name: string; description: string };
  budgetChars: number;
  lastFired?: ReadonlyMap<string, string>;
}): CatalogBudget {
  const listed = input.installed.filter((artifact) => artifact.name !== input.candidate?.name);
  const sizes = new Map(
    listed.map((artifact) => [artifact.name, descriptionLength(artifact.description)]),
  );
  const candidateChars =
    input.candidate === undefined ? 0 : descriptionLength(input.candidate.description);
  const total = [...sizes.values()].reduce((sum, size) => sum + size, candidateChars);
  const fired = input.lastFired ?? new Map<string, string>();
  const ordered = [...sizes.keys()].sort((left, right) => {
    const leftAt = fired.get(left) ?? '';
    const rightAt = fired.get(right) ?? '';
    if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const atRisk: string[] = [];
  let remaining = total;
  for (const name of ordered) {
    if (remaining <= input.budgetChars) break;
    atRisk.push(name);
    remaining -= sizes.get(name) ?? 0;
  }
  return {
    total_chars: total,
    budget_chars: input.budgetChars,
    over_budget: total > input.budgetChars,
    at_risk: atRisk,
    activation_data: fired.size > 0,
  };
}

export function budgetWarningLine(budget: CatalogBudget): string | null {
  if (!budget.over_budget) return null;
  return (
    `The skill descriptions add up to ${budget.total_chars} characters, over the budget of ` +
    `${budget.budget_chars}. The host may drop these from its list: ${budget.at_risk.join(', ')}.`
  );
}

function expandRoot(base: string, root: string): string[] {
  const parts = root.split('/');
  let current = [''];
  for (const part of parts) {
    const next: string[] = [];
    for (const prefix of current) {
      if (part !== '*') {
        next.push(prefix === '' ? part : `${prefix}/${part}`);
        continue;
      }
      const dir = join(base, prefix);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir).sort()) {
        if (statSync(join(dir, entry)).isDirectory()) next.push(`${prefix}/${entry}`);
      }
    }
    current = next;
  }
  return current;
}

function readSkillAt(base: string, rel: string, scope: ArtifactScope): InstalledArtifact | null {
  const text = readTextIfPresent(join(base, rel, SKILL_FILE));
  if (text === null) return null;
  const folder = rel.split('/').at(-1)!;
  const split = splitSkillFrontmatter(text);
  const data = split.ok ? split.data : {};
  return {
    kind: 'skill',
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim() : folder,
    description: typeof data.description === 'string' ? data.description : '',
    path: `${rel}/${SKILL_FILE}`,
    scope,
  };
}

function scanScope(
  base: string,
  roots: readonly string[],
  scope: ArtifactScope,
): InstalledArtifact[] {
  const found: InstalledArtifact[] = [];
  for (const root of roots) {
    for (const expanded of expandRoot(base, root)) {
      const dir = join(base, expanded);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const entry of readdirSync(dir).sort()) {
        const skill = readSkillAt(base, `${expanded}/${entry}`, scope);
        if (skill !== null) found.push(skill);
      }
    }
  }
  return found;
}

export function discoverInstalledSkills(
  projectRoot: string,
  context: SkillPathContext,
  options: { userHome?: string | null } = {},
): InstalledArtifact[] {
  const project = scanScope(projectRoot, skillRoots(context.adapters, context), 'project');
  const home = options.userHome === undefined ? homedir() : options.userHome;
  if (home === null) return project;
  const user = scanScope(home, skillRoots(context.adapters), 'user').map((skill) => ({
    ...skill,
    path: `~/${skill.path}`,
  }));
  return [...project, ...user];
}

function toolList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((tool): tool is string => typeof tool === 'string');
  if (typeof value !== 'string') return undefined;
  return value
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool !== '');
}

function readAgentAt(base: string, rel: string, scope: ArtifactScope): InstalledArtifact | null {
  const text = readTextIfPresent(join(base, rel));
  if (text === null) return null;
  const stem = rel
    .split('/')
    .at(-1)!
    .replace(/\.[^.]+$/u, '');
  if (rel.endsWith('.toml')) {
    const name = /^name\s*=\s*"([^"]*)"/mu.exec(text)?.[1];
    const description = /^description\s*=\s*"((?:[^"\\]|\\.)*)"/mu.exec(text)?.[1];
    return {
      kind: 'agent',
      name: name && name.trim() !== '' ? name.trim() : stem,
      description: description === undefined ? '' : (JSON.parse(`"${description}"`) as string),
      path: rel,
      scope,
    };
  }
  const split = splitSkillFrontmatter(text);
  const data = split.ok ? split.data : {};
  const tools = toolList(data.tools);
  return {
    kind: 'agent',
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim() : stem,
    description: typeof data.description === 'string' ? data.description : '',
    path: rel,
    scope,
    ...(tools === undefined ? {} : { tools }),
  };
}

function scanAgentScope(
  base: string,
  context: SkillPathContext,
  scope: ArtifactScope,
): InstalledArtifact[] {
  const found: InstalledArtifact[] = [];
  const options = { paqadRepo: scope === 'project' && context.paqadRepo };
  for (const root of agentRoots(context.adapters, options)) {
    for (const expanded of expandRoot(base, root)) {
      const dir = join(base, expanded);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const entry of readdirSync(dir).sort()) {
        const rel = `${expanded}/${entry}`;
        if (agentNameOf(rel, context.adapters, options) === null) continue;
        if (!statSync(join(dir, entry)).isFile()) continue;
        const agent = readAgentAt(base, rel, scope);
        if (agent !== null) found.push(agent);
      }
    }
  }
  return found;
}

export function discoverInstalledAgents(
  projectRoot: string,
  context: SkillPathContext,
  options: { userHome?: string | null } = {},
): InstalledArtifact[] {
  const project = scanAgentScope(projectRoot, context, 'project');
  const home = options.userHome === undefined ? homedir() : options.userHome;
  if (home === null) return project;
  const user = scanAgentScope(home, { ...context, paqadRepo: false }, 'user').map((agent) => ({
    ...agent,
    path: `~/${agent.path}`,
  }));
  return [...project, ...user];
}

export function buildOverlapReport(input: {
  candidate: OverlapCandidate;
  installed: readonly InstalledArtifact[];
  threshold: number;
  budgetChars: number;
  candidateDescription?: string;
  lastFired?: ReadonlyMap<string, string>;
}): OverlapReport {
  const sameKind = input.installed.filter((artifact) => artifact.kind === input.candidate.kind);
  const { scores, collisions } = findCollisions(input.candidate, sameKind, input.threshold);
  return {
    kind: input.candidate.kind,
    candidate: input.candidate.name,
    threshold: input.threshold,
    scores,
    collisions,
    shadowing: findNameShadowing(input.candidate, sameKind),
    budget: catalogBudget({
      installed: sameKind,
      candidate:
        input.candidateDescription === undefined
          ? undefined
          : { name: input.candidate.name, description: input.candidateDescription },
      budgetChars: input.budgetChars,
      lastFired: input.lastFired,
    }),
  };
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

export function renderOverlapReport(report: OverlapReport): string {
  const lines = [`# Overlap check: ${report.candidate}`, ''];
  lines.push(`Collision threshold: ${formatScore(report.threshold)} (Jaccard of word sets).`, '');
  lines.push('## Collisions', '');
  if (report.collisions.length === 0) {
    lines.push(`None: no installed ${report.kind} scores at or above the threshold.`);
  } else {
    for (const collision of report.collisions) {
      lines.push(
        collision.subset === true
          ? `- ${collision.candidate} is a subset of ${collision.existing} (${collision.existing_path}): ` +
              `its tools are all in ${collision.existing} and its job is contained at ` +
              `${formatScore(collision.score)}. Extending ${collision.existing} is recommended.`
          : `- ${collision.candidate} collides with ${collision.existing} (${collision.existing_path}), ` +
              `score ${formatScore(collision.score)}. Extending ${collision.existing} is recommended.`,
      );
    }
  }
  lines.push('', '## Name shadowing', '');
  if (report.shadowing.length === 0) {
    lines.push('None.');
  } else {
    for (const entry of report.shadowing) lines.push(`- ${shadowingLine(entry)}`);
  }
  if (report.kind === 'skill') {
    lines.push('', '## Catalog budget', '');
    const warning = budgetWarningLine(report.budget);
    lines.push(
      warning ??
        `Within budget: ${report.budget.total_chars} of ${report.budget.budget_chars} characters.`,
    );
    if (!report.budget.activation_data) {
      lines.push('', 'No activation data yet, so skills at risk are ordered by name.');
    }
  }
  lines.push('', '## Scores', '');
  if (report.scores.length === 0) {
    lines.push(`No other installed ${report.kind}.`);
  } else {
    lines.push('| Installed | Score |', '| --- | --- |');
    for (const entry of report.scores)
      lines.push(`| ${entry.existing} | ${formatScore(entry.score)} |`);
  }
  lines.push('');
  return lines.join('\n');
}
