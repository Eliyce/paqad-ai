import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { gitPathList } from '@/pipeline/git-paths.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { ACTIVATIONS_LEDGER, forEachActivation } from '../activations.js';
import { readAuthoringConfig } from '../config.js';
import { DELEGATIONS_LEDGER, forEachDelegation } from '../delegations.js';
import { readTextIfPresent } from '../fs-io.js';
import { discoverInstalledAgents, overlapScore, type InstalledArtifact } from '../overlap.js';
import {
  classifyAgentPath,
  findAgentPaths,
  findSkillPaths,
  agentRoots,
  readSkillPathContext,
  skillFolderOf,
  skillRoots,
  type AgentPathClass,
  type SkillPathContext,
} from '../paths.js';
import { meetsThreshold } from '../thresholds.js';
import { estimateTokens } from '../tokens.js';
import { lintAgentInProject, readPermissionDecisionIds, type AgentLintHost } from './agent-lint.js';
import {
  compareText,
  countFindings,
  formatLintJson,
  sortFindings,
  type LintFinding,
} from './runner.js';
import { lintSkillFolder } from './skill-lint.js';

export type AuditKind = 'skill' | 'agent';
export type AuditGroupBy = 'rule' | 'folder';
export type AuditItemClass = 'skill' | AgentPathClass;

export const AUDIT_GROUP_BY: readonly AuditGroupBy[] = ['rule', 'folder'];
export const DEFAULT_SKILL_AUDIT_REPORT = '.paqad/tmp/skill-lint-all.json';
export const DEFAULT_AGENT_AUDIT_REPORT = '.paqad/tmp/agent-lint-all.json';
export const FIRED_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export interface AuditRival {
  name: string;
  score: number;
}

export interface AuditItem {
  name: string;
  path: string;
  group: string;
  class: AuditItemClass;
  blocking: number;
  warnings: number;
  body_tokens: number;
  listing_tokens: number;
  listed: boolean;
  rival: AuditRival | null;
  script_test_findings: number;
  fired_30d: number | null;
  findings: LintFinding[];
}

export interface AuditPersona {
  name: string;
  path: string;
  group: string;
  body_tokens: number;
}

export interface AuditRuleCount {
  rule: string;
  blocking: number;
  warnings: number;
}

export interface AuditGroup {
  key: string;
  blocking: number;
  warnings: number;
  findings: LintFinding[];
}

export interface AuditReport {
  kind: AuditKind;
  group_by: AuditGroupBy;
  as_of: string | null;
  items_count: number;
  blocking: number;
  warnings: number;
  rules: AuditRuleCount[];
  groups: AuditGroup[];
  items: AuditItem[];
  personas: AuditPersona[];
}

export interface AuditOptions {
  groupBy?: AuditGroupBy;
  asOf?: string;
  files?: readonly string[];
  context?: SkillPathContext;
  agentSources?: AgentAuditSources;
}

export class AuditUsageError extends Error {}

function normalize(path: string): string {
  return path.replaceAll('\\', '/');
}

function walkFiles(projectRoot: string, rel: string, out: string[]): void {
  const abs = join(projectRoot, rel);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs).sort(compareText)) {
    const child = rel === '' ? entry : `${rel}/${entry}`;
    const stat = lstatSync(join(projectRoot, child));
    if (stat.isDirectory()) walkFiles(projectRoot, child, out);
    else out.push(child);
  }
}

function rootPrefix(root: string): string {
  return root.split('/*')[0]!;
}

export function listProjectFiles(projectRoot: string, roots: readonly string[]): string[] {
  const listed = gitPathList(projectRoot, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  if (listed !== null) {
    return [...new Set(listed.map(normalize))]
      .filter((path) => existsSync(join(projectRoot, path)))
      .sort(compareText);
  }
  const files: string[] = [];
  for (const root of new Set(roots.map(rootPrefix))) walkFiles(projectRoot, root, files);
  return [...new Set(files)].sort(compareText);
}

const GROUP_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/^runtime\/base\/(?:skills|agents)$/u, 'base'],
  [/^runtime\/claude-plugin\/(?:skills|agents)$/u, 'plugin'],
  [/^runtime\/capabilities\/([^/]+)\/(?:skills|agents)$/u, '$1'],
  [/^runtime\/templates\/stage-agents$/u, 'templates'],
];

export function auditGroupOf(root: string): string {
  for (const [pattern, name] of GROUP_PATTERNS) {
    if (pattern.test(root)) return root.replace(pattern, name);
  }
  return root;
}

function bodyAndDescription(text: string | null): {
  body: string;
  description: string;
  listed: boolean;
} {
  if (text === null) return { body: '', description: '', listed: true };
  const split = splitSkillFrontmatter(text);
  if (!split.ok) return { body: text, description: '', listed: true };
  const description = typeof split.data.description === 'string' ? split.data.description : '';
  return { body: split.body, description, listed: split.data['disable-model-invocation'] !== true };
}

function windowStart(asOf: string): { start: number; end: number } {
  const end = Date.parse(`${asOf}T23:59:59.999Z`);
  if (Number.isNaN(end)) throw new AuditUsageError(`--as-of ${asOf} is not a date (YYYY-MM-DD).`);
  return { start: end - FIRED_WINDOW_DAYS * DAY_MS, end };
}

function firedCounts(
  projectRoot: string,
  kind: AuditKind,
  asOf: string,
): Map<string, number> | null {
  const ledger = kind === 'skill' ? ACTIVATIONS_LEDGER : DELEGATIONS_LEDGER;
  if (!existsSync(join(projectRoot, ledger))) return null;
  const { start, end } = windowStart(asOf);
  const counts = new Map<string, number>();
  const add = (name: string, at: string): void => {
    const time = Date.parse(at);
    if (Number.isNaN(time) || time < start || time > end) return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  if (kind === 'skill') forEachActivation(projectRoot, (row) => add(row.skill, row.at));
  else forEachDelegation(projectRoot, (row) => add(row.agent.replace(/^paqad:/u, ''), row.at));
  return counts;
}

function rivalsOf(
  items: ReadonlyArray<{ path: string; name: string; description: string }>,
  threshold: number,
): Map<string, AuditRival> {
  const rivals = new Map<string, AuditRival>();
  for (const item of items) {
    let best: AuditRival | null = null;
    for (const other of items) {
      if (other.name === item.name || item.description === '' || other.description === '') {
        continue;
      }
      const score = overlapScore(item.description, other.description);
      if (!meetsThreshold(score, threshold)) continue;
      const rounded = Math.round(score * 100) / 100;
      if (
        best === null ||
        rounded > best.score ||
        (rounded === best.score && compareText(other.name, best.name) < 0)
      ) {
        best = { name: other.name, score: rounded };
      }
    }
    if (best !== null) rivals.set(item.path, best);
  }
  return rivals;
}

function ruleCounts(findings: readonly LintFinding[]): AuditRuleCount[] {
  const counts = new Map<string, AuditRuleCount>();
  for (const finding of findings) {
    const entry = counts.get(finding.rule) ?? { rule: finding.rule, blocking: 0, warnings: 0 };
    if (finding.severity === 'block') entry.blocking += 1;
    else entry.warnings += 1;
    counts.set(finding.rule, entry);
  }
  return [...counts.values()].sort((left, right) => compareText(left.rule, right.rule));
}

function groupFindings(items: readonly AuditItem[], groupBy: AuditGroupBy): AuditGroup[] {
  const groups = new Map<string, LintFinding[]>();
  for (const item of items) {
    for (const finding of item.findings) {
      const key = groupBy === 'rule' ? finding.rule : item.path;
      groups.set(key, [...(groups.get(key) ?? []), finding]);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, findings]) => ({
      key,
      ...countFindings(findings),
      findings: sortFindings(findings),
    }));
}

interface DraftItem {
  name: string;
  path: string;
  group: string;
  class: AuditItemClass;
  description: string;
  body: string;
  listed: boolean;
  findings: LintFinding[];
}

function finishReport(
  projectRoot: string,
  kind: AuditKind,
  drafts: DraftItem[],
  personas: AuditPersona[],
  options: AuditOptions,
): AuditReport {
  const groupBy = options.groupBy ?? 'rule';
  const threshold = readAuthoringConfig(projectRoot).authoring_collision_jaccard;
  const sorted = [...drafts].sort((left, right) => compareText(left.path, right.path));
  const rivals = rivalsOf(
    sorted.filter((item) => item.class !== 'template'),
    threshold,
  );
  const fired = options.asOf === undefined ? null : firedCounts(projectRoot, kind, options.asOf);
  const items: AuditItem[] = sorted.map((draft) => {
    const findings = sortFindings(draft.findings);
    return {
      name: draft.name,
      path: draft.path,
      group: draft.group,
      class: draft.class,
      ...countFindings(findings),
      body_tokens: estimateTokens(draft.body),
      listing_tokens: estimateTokens(draft.description),
      listed: draft.listed,
      rival: rivals.get(draft.path) ?? null,
      script_test_findings: findings.filter((finding) => finding.rule === 'SK-010').length,
      fired_30d: fired === null ? null : (fired.get(draft.name) ?? 0),
      findings,
    };
  });
  const all = items.flatMap((item) => item.findings);
  return {
    kind,
    group_by: groupBy,
    as_of: options.asOf ?? null,
    items_count: items.length,
    ...countFindings(all),
    rules: ruleCounts(all),
    groups: groupFindings(items, groupBy),
    items,
    personas: [...personas].sort((left, right) => compareText(left.path, right.path)),
  };
}

export function lintAllSkills(projectRoot: string, options: AuditOptions = {}): AuditReport {
  const context = options.context ?? readSkillPathContext(projectRoot);
  const files =
    options.files ?? listProjectFiles(projectRoot, skillRoots(context.adapters, context));
  const folders = new Map<string, string>();
  for (const file of findSkillPaths(files, context.adapters, context)) {
    const found = skillFolderOf(file, context.adapters, context);
    if (found !== null && existsSync(join(projectRoot, found.folder, 'SKILL.md'))) {
      folders.set(found.folder, found.name);
    }
  }
  const config = readAuthoringConfig(projectRoot);
  const drafts: DraftItem[] = [...folders.keys()].sort(compareText).map((folder) => {
    const result = lintSkillFolder(join(projectRoot, folder), {
      projectRoot,
      claudeCode: context.adapters.includes('claude-code'),
      bodyMaxTokens: config.skill_body_max_tokens,
    });
    const text = readTextIfPresent(join(projectRoot, folder, 'SKILL.md'));
    const { body, description, listed } = bodyAndDescription(text);
    return {
      name: result.skill,
      path: folder,
      group: auditGroupOf(dirname(folder)),
      class: 'skill',
      description,
      body,
      listed,
      findings: result.findings.map((finding) => ({
        ...finding,
        file: existsSync(join(projectRoot, folder, finding.file))
          ? `${folder}/${finding.file}`
          : finding.file,
      })),
    };
  });
  return finishReport(projectRoot, 'skill', drafts, [], options);
}

export interface RenderedTemplateAgent {
  name: string;
  path: string;
  host: AgentLintHost;
  content: string;
}

export interface AgentAuditSources {
  renderTemplate: (templatePath: string) => RenderedTemplateAgent[];
  dispatched: ReadonlySet<string>;
}

const NO_AGENT_SOURCES: AgentAuditSources = { renderTemplate: () => [], dispatched: new Set() };

export function lintAllAgents(projectRoot: string, options: AuditOptions = {}): AuditReport {
  const sources = options.agentSources ?? NO_AGENT_SOURCES;
  const dispatched = (name: string) =>
    sources.dispatched.has(name) ? { invocation: 'dispatched' as const } : {};
  const context = options.context ?? readSkillPathContext(projectRoot);
  const files =
    options.files ?? listProjectFiles(projectRoot, agentRoots(context.adapters, context));
  const installed: InstalledArtifact[] = discoverInstalledAgents(projectRoot, context, {
    userHome: null,
  });
  const drafts: DraftItem[] = [];
  const personas: AuditPersona[] = [];
  for (const path of findAgentPaths(files, context.adapters, context).sort(compareText)) {
    if (path.endsWith('.toml')) continue;
    const text = readTextIfPresent(join(projectRoot, path));
    if (text === null) continue;
    const split = splitSkillFrontmatter(text);
    const kind = classifyAgentPath(path, split.ok);
    const group = auditGroupOf(dirname(path));
    if (kind === 'persona') {
      personas.push({
        name: basename(path).replace(/\.[^.]+$/u, ''),
        path,
        group,
        body_tokens: estimateTokens(text),
      });
      continue;
    }
    if (kind === 'template') {
      for (const rendered of sources.renderTemplate(path)) {
        const result = lintAgentInProject(projectRoot, rendered.path, {
          content: rendered.content,
          host: rendered.host,
          permissionDecisions: readPermissionDecisionIds(projectRoot, rendered.name),
          context,
          installedAgents: installed,
          ...dispatched(rendered.name),
        });
        drafts.push({
          name: rendered.name,
          path: rendered.path,
          group,
          class: 'template',
          ...bodyAndDescription(rendered.content),
          findings: result.findings,
        });
      }
      continue;
    }
    const stem = basename(path).replace(/\.[^.]+$/u, '');
    const result = lintAgentInProject(projectRoot, path, {
      context,
      installedAgents: installed,
      ...dispatched(stem),
    });
    drafts.push({
      name: result.agent,
      path,
      group,
      class: 'agent',
      ...bodyAndDescription(text),
      findings: result.findings,
    });
  }
  return finishReport(projectRoot, 'agent', drafts, personas, options);
}

export function parseGroupBy(value: string | undefined): AuditGroupBy {
  if (value === undefined) return 'rule';
  if ((AUDIT_GROUP_BY as readonly string[]).includes(value)) return value as AuditGroupBy;
  throw new AuditUsageError(`--group-by ${value} is not one of ${AUDIT_GROUP_BY.join(', ')}.`);
}

export interface RunAuditOptions {
  report?: string;
  groupBy?: string;
  asOf?: string;
  agentSources?: AgentAuditSources;
}

export interface RunAuditResult {
  report: AuditReport;
  reportPath: string;
  summary: string;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function runAudit(
  projectRoot: string,
  kind: AuditKind,
  options: RunAuditOptions = {},
): RunAuditResult {
  const groupBy = parseGroupBy(options.groupBy);
  if (options.asOf !== undefined) windowStart(options.asOf);
  const report =
    kind === 'skill'
      ? lintAllSkills(projectRoot, { groupBy, asOf: options.asOf })
      : lintAllAgents(projectRoot, {
          groupBy,
          asOf: options.asOf,
          agentSources: options.agentSources,
        });
  const reportPath =
    options.report ?? (kind === 'skill' ? DEFAULT_SKILL_AUDIT_REPORT : DEFAULT_AGENT_AUDIT_REPORT);
  const abs = resolve(projectRoot, reportPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, formatLintJson(report), 'utf8');
  const personas =
    kind === 'agent' ? `, ${plural(report.personas.length, 'persona')} listed apart` : '';
  const summary =
    `**▸ paqad** · ${kind} lint --all: ${plural(report.items_count, kind)}${personas}, ` +
    `${plural(report.blocking, 'blocking finding')}, ${plural(report.warnings, 'warning')}. ` +
    `Report: ${reportPath}`;
  return { report, reportPath, summary };
}
