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
  return {
    kind: 'agent',
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim() : stem,
    description: typeof data.description === 'string' ? data.description : '',
    path: rel,
    scope,
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
        `- ${collision.candidate} collides with ${collision.existing} (${collision.existing_path}), ` +
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
  lines.push('', '## Catalog budget', '');
  const warning = budgetWarningLine(report.budget);
  lines.push(
    warning ??
      `Within budget: ${report.budget.total_chars} of ${report.budget.budget_chars} characters.`,
  );
  if (!report.budget.activation_data) {
    lines.push('', 'No activation data yet, so skills at risk are ordered by name.');
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
