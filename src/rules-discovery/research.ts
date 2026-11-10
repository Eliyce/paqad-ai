import { SOURCE_COLUMNS } from '@/authoring/stages/sources.js';

import { atomicWriteJson, readJsonFile } from './files.js';
import { packageKey } from './inventory.js';
import { absRunFile } from './paths.js';
import type { InventoryPackage, StackInventory } from './types.js';

export const RESEARCH_IDEA_CAP = 8;
export const SOURCE_MAX_AGE_DAYS = 365;

export type ResearchReason = 'new' | 'version-changed' | 'framework' | 'other';
export type ResearchState = 'in-progress' | 'skipped-offline' | 'stopped' | 'done';

export interface ResearchTarget {
  key: string;
  name: string;
  ecosystem: string;
  installed: string | null;
  reason: ResearchReason;
}

export interface ResearchProgress {
  schema_version: 1;
  state: ResearchState;
  order: ResearchTarget[];
  done: string[];
  skipped_private: string[];
  unreached: string[];
  updated_at: string;
}

export interface ResearchSource {
  id: string;
  fact: string;
  origin: string;
  date: string;
  verified: string;
  package: string;
  version: string | null;
  published?: string | null;
  old?: boolean;
}

export interface ResearchIdea {
  idea_id: string;
  text: string;
  why: string;
  sources: string[];
  applies_to: { package: string; versions: string };
  code_breaks: number;
}

const REASON_RANK: Record<ResearchReason, number> = {
  new: 0,
  'version-changed': 1,
  framework: 2,
  other: 3,
};

function reasonFor(pkg: InventoryPackage, frameworks: readonly string[]): ResearchReason {
  if (pkg.status === 'new') return 'new';
  if (pkg.status === 'version-changed') return 'version-changed';
  const name = pkg.name.toLowerCase();
  const isFramework = frameworks.some((framework) => {
    const f = framework.toLowerCase();
    return (
      name === f || name.endsWith(`/${f}`) || name.startsWith(`${f}/`) || name.includes(`${f}:`)
    );
  });
  return isFramework ? 'framework' : 'other';
}

export function planResearch(inventory: StackInventory): {
  order: ResearchTarget[];
  skipped_private: string[];
} {
  const live = inventory.packages.filter((pkg) => pkg.status !== 'removed');
  const seen = new Set<string>();
  const order: ResearchTarget[] = [];
  const skipped = new Set<string>();
  for (const pkg of live) {
    const key = packageKey(pkg);
    if (pkg.private) {
      skipped.add(pkg.name);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    order.push({
      key,
      name: pkg.name,
      ecosystem: pkg.ecosystem,
      installed: pkg.installed ?? pkg.declared,
      reason: reasonFor(pkg, inventory.frameworks),
    });
  }
  order.sort(
    (left, right) =>
      REASON_RANK[left.reason] - REASON_RANK[right.reason] || left.key.localeCompare(right.key),
  );
  return { order, skipped_private: [...skipped].sort() };
}

export function readResearch(projectRoot: string, runId: string): ResearchProgress | null {
  const read = readJsonFile<ResearchProgress>(absRunFile(projectRoot, runId, 'research'));
  if (read.state === 'unreadable') {
    throw new Error(`research.json in run ${runId} is unreadable: ${read.error}`);
  }
  return read.state === 'ok' ? read.value : null;
}

function writeResearch(projectRoot: string, runId: string, progress: ResearchProgress): void {
  atomicWriteJson(absRunFile(projectRoot, runId, 'research'), progress);
}

function unreachedOf(order: readonly ResearchTarget[], done: readonly string[]): string[] {
  const finished = new Set(done);
  return order.filter((target) => !finished.has(target.key)).map((target) => target.key);
}

export function startResearch(
  projectRoot: string,
  runId: string,
  inventory: StackInventory,
  options: { offline: boolean; now?: Date },
): ResearchProgress {
  const now = (options.now ?? new Date()).toISOString();
  const existing = readResearch(projectRoot, runId);
  const plan = planResearch(inventory);
  const done = existing?.done ?? [];
  const progress: ResearchProgress = {
    schema_version: 1,
    state: options.offline ? 'skipped-offline' : 'in-progress',
    order: plan.order,
    done,
    skipped_private: plan.skipped_private,
    unreached: unreachedOf(plan.order, done),
    updated_at: now,
  };
  if (!options.offline && progress.unreached.length === 0) progress.state = 'done';
  writeResearch(projectRoot, runId, progress);
  return progress;
}

export function nextTargets(progress: ResearchProgress): ResearchTarget[] {
  const unreached = new Set(progress.unreached);
  return progress.order.filter((target) => unreached.has(target.key));
}

export function markResearched(
  projectRoot: string,
  runId: string,
  key: string,
  now: Date = new Date(),
): ResearchProgress {
  const progress = readResearch(projectRoot, runId);
  if (progress === null) throw new Error(`research has not started in run ${runId}`);
  if (!progress.order.some((target) => target.key === key)) {
    throw new Error(`${key} is not in the research plan of run ${runId}`);
  }
  const done = progress.done.includes(key) ? progress.done : [...progress.done, key];
  const unreached = unreachedOf(progress.order, done);
  const next: ResearchProgress = {
    ...progress,
    state: unreached.length === 0 ? 'done' : 'in-progress',
    done,
    unreached,
    updated_at: now.toISOString(),
  };
  writeResearch(projectRoot, runId, next);
  return next;
}

export function stopResearch(
  projectRoot: string,
  runId: string,
  now: Date = new Date(),
): ResearchProgress {
  const progress = readResearch(projectRoot, runId);
  if (progress === null) throw new Error(`research has not started in run ${runId}`);
  const next: ResearchProgress = {
    ...progress,
    state: progress.unreached.length === 0 ? 'done' : 'stopped',
    updated_at: now.toISOString(),
  };
  writeResearch(projectRoot, runId, next);
  return next;
}

function majorOf(version: string | null | undefined): string | null {
  const match = /(\d+)/.exec(version ?? '');
  return match?.[1] ?? null;
}

function ageDays(date: string, now: Date): number | null {
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? null : (now.getTime() - parsed) / 86_400_000;
}

export function isOldSource(source: ResearchSource, installed: string | null, now: Date): boolean {
  const age = ageDays(source.published ?? source.date, now);
  const tooOld = age === null || age > SOURCE_MAX_AGE_DAYS;
  const installedMajor = majorOf(installed);
  const sourceMajor = majorOf(source.version);
  const otherMajor =
    installedMajor !== null && sourceMajor !== null && installedMajor !== sourceMajor;
  return tooOld || otherMajor;
}

export function pickSources(
  candidates: readonly ResearchSource[],
  installed: string | null,
  now: Date,
): ResearchSource[] {
  const fresh = candidates.filter((source) => !isOldSource(source, installed, now));
  if (fresh.length > 0) return fresh.map((source) => ({ ...source, old: false }));
  return candidates.map((source) => ({ ...source, old: true }));
}

export interface ResearchCheckInput {
  ideas: readonly ResearchIdea[];
  sources: readonly ResearchSource[];
  inventory: StackInventory;
  now: Date;
}

export function checkResearch(input: ResearchCheckInput): {
  problems: string[];
  sources: ResearchSource[];
} {
  const problems: string[] = [];
  const privateNames = new Set(
    input.inventory.packages.filter((pkg) => pkg.private).map((pkg) => pkg.name),
  );
  const installedOf = new Map(
    input.inventory.packages.map((pkg) => [pkg.name, pkg.installed ?? pkg.declared]),
  );
  const byPackage = new Map<string, ResearchSource[]>();
  for (const source of input.sources) {
    if (privateNames.has(source.package)) {
      problems.push(`${source.id} names private package ${source.package}`);
      continue;
    }
    if (!/^https?:\/\//.test(source.origin)) problems.push(`${source.id} has no link`);
    if (ageDays(source.date, input.now) === null) problems.push(`${source.id} has no date read`);
    byPackage.set(source.package, [...(byPackage.get(source.package) ?? []), source]);
  }
  const kept = [...byPackage.entries()].flatMap(([pkg, list]) =>
    pickSources(list, installedOf.get(pkg) ?? null, input.now),
  );
  const keptIds = new Set(kept.map((source) => source.id));
  const perPackage = new Map<string, number>();
  for (const idea of input.ideas) {
    const pkg = idea.applies_to?.package ?? '';
    if (privateNames.has(pkg)) problems.push(`${idea.idea_id} researches private package ${pkg}`);
    if (!idea.applies_to?.versions) problems.push(`${idea.idea_id} names no package version`);
    perPackage.set(pkg, (perPackage.get(pkg) ?? 0) + 1);
    const usable = (idea.sources ?? []).filter((id) => keptIds.has(id));
    if (usable.length === 0) {
      problems.push(`${idea.idea_id} has no usable source with a link and a date read`);
    }
  }
  for (const [pkg, count] of perPackage) {
    if (count > RESEARCH_IDEA_CAP) {
      problems.push(`${pkg} has ${count} ideas; at most ${RESEARCH_IDEA_CAP} are allowed`);
    }
  }
  return { problems, sources: kept.sort((left, right) => left.id.localeCompare(right.id)) };
}

export function sourcesTable(sources: readonly ResearchSource[]): string {
  const header = `| ${SOURCE_COLUMNS.join(' | ')} |`;
  const rule = `| ${SOURCE_COLUMNS.map(() => '---').join(' | ')} |`;
  const rows = sources.map(
    (source) =>
      `| ${source.id} | ${source.fact.replace(/\|/g, '/')} | ${source.origin} | ${source.date}${source.old ? ' (old)' : ''} | ${source.verified} |`,
  );
  return [header, rule, ...rows].join('\n');
}

export function readResearchFiles(
  projectRoot: string,
  runId: string,
): { ideas: ResearchIdea[]; sources: ResearchSource[] } {
  const ideas = readJsonFile<ResearchIdea[]>(absRunFile(projectRoot, runId, 'fromResearch'));
  const sources = readJsonFile<ResearchSource[]>(absRunFile(projectRoot, runId, 'sources'));
  for (const [name, read] of [
    ['from-research.json', ideas],
    ['sources.json', sources],
  ] as const) {
    if (read.state === 'unreadable') {
      throw new Error(`${name} in run ${runId} is unreadable: ${read.error}`);
    }
  }
  return {
    ideas: ideas.state === 'ok' && Array.isArray(ideas.value) ? ideas.value : [],
    sources: sources.state === 'ok' && Array.isArray(sources.value) ? sources.value : [],
  };
}

export function writeCheckedSources(
  projectRoot: string,
  runId: string,
  sources: readonly ResearchSource[],
): void {
  atomicWriteJson(absRunFile(projectRoot, runId, 'sources'), sources);
}
