import {
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';

import { join } from 'pathe';

import { sha256Hex } from '@/compliance/markdown.js';
import { PATHS } from '@/core/constants/paths.js';
import type { AgentRole } from '@/core/types/agent.js';
import { readUnitFile } from '@/session-ledger/ledger.js';
import type { ExpertNotesArtifact } from '@/spec-pipeline/experts/notes.js';
import type { ExpertSynthesis } from '@/spec-pipeline/experts/synthesis.js';
import { lensPathForRole } from '@/spec-pipeline/experts/brief.js';
import {
  appendSpecCorrectionRow,
  appendSpecStepRow,
  readStagedText,
  SPEC_PIPELINE_STAGING_DIR,
  writeExpertNotes,
  writeExpertRoster,
  writeExpertSynthesis,
  writeLabel,
  writeQuestions,
  writeRequest,
  writeStagedText,
  type ExpertRosterEntry,
  type StagedFile,
} from '@/spec-pipeline/run-store.js';
import type { LabelArtifact, PipelineStep, QuestionsArtifact } from '@/spec-pipeline/types.js';
import {
  SPEC_CORRECTION_KIND,
  SPEC_STEP_OUTCOMES,
  type SpecStepOutcome,
} from '@/stage-evidence/types.js';

import { documentSessionId } from './bundle-document.js';
import { buildTextHeader, renderFrontMatter, rowRecordedAt, splitFrontMatter } from './envelope.js';
import { listFeatureDirs } from './enumerate.js';
import { seedFeatureRecord } from './feature-record.js';
import {
  featureChangeKey,
  featureFilePath,
  isFeatureDirName,
  parseFeatureDirName,
  type FeatureBundleFile,
} from './paths.js';
import { readSessionControl } from './session-control.js';
import { appendFeatureStageRow } from './stage-ledger.js';
import { FEATURE_DOC_SCHEMA_VERSION, SPEC_SOURCE_DOC_TYPE } from './types.js';

export const LEGACY_SPECS_DIR = '.paqad/_specs';

const LEGACY_SPECS_IGNORE_LINE = '_specs/';

const PIPELINE_DIR = 'pipeline';

const UNKNOWN = 'unknown';

const STAGED_SOURCES: readonly [StagedFile, string][] = [
  ['task', 'task.json'],
  ['trace', 'trace.json'],
  ['grounding', 'grounding.json'],
  ['finish', 'finish.json'],
  ['craft', 'spec.md'],
];

const MERGED_SOURCES = [
  'log.jsonl',
  'request.md',
  'label.json',
  'questions.json',
  'experts.json',
  'expert-notes.json',
  'expert-synthesis.json',
  'corrections.jsonl',
];

const RETIRED_SOURCES = ['expert-merge.json'];

const RETIRED_REDO = /\.redo-\d+$/;

const RETIRED_BRIEFS_DIR = 'briefs';

export const HELD_SESSION_STALE_MS = 24 * 60 * 60 * 1000;

export interface EvidenceMigrationOptions {
  sessionId?: string | null;
  dryRun?: boolean;
  staleAfterMs?: number;
  now?: () => Date;
}

export type EvidenceMigrationAction =
  | {
      kind: 'merge';
      source: string;
      bundle: string;
      created: boolean;
      added: string[];
      staged: string[];
    }
  | { kind: 'drop-duplicate'; source: string; kept: string }
  | { kind: 'skip-held'; source: string; bundle: string }
  | { kind: 'skip-unrecognized'; source: string }
  | { kind: 'failed'; source: string; error: string }
  | { kind: 'leave-files'; source: string; files: string[] }
  | { kind: 'delete-failed'; path: string; error: string }
  | { kind: 'delete-tmp'; path: string }
  | { kind: 'remove-specs-dir' }
  | { kind: 'remove-gitignore-line' };

export interface EvidenceMigrationResult {
  dryRun: boolean;
  actions: EvidenceMigrationAction[];
  leftBehind: string[];
}

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function readJson(abs: string): unknown {
  const raw = readText(abs);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function atomicWrite(abs: string, text: string): void {
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, abs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listEntries(abs: string): { name: string; dir: boolean }[] {
  try {
    return readdirSync(abs, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      dir: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

function listFilesUnder(abs: string, prefix = ''): string[] {
  return listEntries(abs)
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.dir ? listFilesUnder(join(abs, entry.name), rel) : [rel];
    })
    .sort();
}

interface LegacyRun {
  name: string;
  ulid: string;
  log: Record<string, unknown>[];
}

function pipelinePath(projectRoot: string, run: string, file: string): string {
  return join(projectRoot, LEGACY_SPECS_DIR, run, PIPELINE_DIR, file);
}

function readLog(projectRoot: string, run: string, file = 'log.jsonl'): Record<string, unknown>[] {
  const raw = readText(pipelinePath(projectRoot, run, file)) ?? '';
  return raw.split('\n').flatMap((line) => {
    try {
      const row: unknown = JSON.parse(line);
      return isRecord(row) ? [row] : [];
    } catch {
      return [];
    }
  });
}

function readRun(projectRoot: string, name: string): LegacyRun {
  return { name, ulid: featureChangeKey(name), log: readLog(projectRoot, name) };
}

function completedSteps(run: LegacyRun): Set<string> {
  return new Set(
    run.log
      .filter((row) => row.outcome === 'complete' && typeof row.step === 'string')
      .map((row) => row.step as string),
  );
}

function isChangePlaceholder(name: string): boolean {
  const parts = parseFeatureDirName(name);
  return parts !== null && parts.issue === null && parts.slug === 'change';
}

function pickRun(runs: LegacyRun[]): LegacyRun {
  const renamed = runs.filter((run) => !isChangePlaceholder(run.name));
  const finished = renamed.find((run) => completedSteps(run).has('finish'));
  if (finished) return finished;
  return [...runs].sort(
    (a, b) =>
      completedSteps(b).size - completedSteps(a).size ||
      Number(isChangePlaceholder(a.name)) - Number(isChangePlaceholder(b.name)) ||
      a.name.localeCompare(b.name),
  )[0]!;
}

function bundleClosed(projectRoot: string, bundle: string): boolean {
  return readUnitFile(projectRoot, featureFilePath(bundle, 'stageEvidence')).some(
    (row) => row.kind === 'close',
  );
}

function lastSeenMs(updatedAt: string, rows: Record<string, unknown>[], sessionId: string): number {
  const times = [
    Date.parse(updatedAt),
    ...rows
      .filter((row) => row.session_id === sessionId)
      .map((row) => Date.parse(rowRecordedAt(row)!)),
  ].filter((time) => !Number.isNaN(time));
  return times.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...times);
}

interface HoldCheck {
  self: string | null;
  staleAfterMs: number;
  nowMs: number;
}

function heldByAnotherSession(projectRoot: string, bundle: string, hold: HoldCheck): boolean {
  if (bundleClosed(projectRoot, bundle)) return false;
  let rows: Record<string, unknown>[] | null = null;
  for (const entry of listEntries(join(projectRoot, PATHS.FEATURE_EVIDENCE_SESSION_DIR))) {
    if (entry.dir || !entry.name.endsWith('.json')) continue;
    const sessionId = entry.name.slice(0, -'.json'.length);
    if (sessionId === hold.self) continue;
    const control = readSessionControl(projectRoot, sessionId);
    if (control.active !== bundle && !control.paused.includes(bundle)) continue;
    rows ??= readUnitFile(projectRoot, featureFilePath(bundle, 'stageEvidence'));
    if (hold.nowMs - lastSeenMs(control.updated_at, rows, sessionId) <= hold.staleAfterMs) {
      return true;
    }
  }
  return false;
}

function bundleHas(projectRoot: string, bundle: string, file: FeatureBundleFile): boolean {
  return readText(join(projectRoot, featureFilePath(bundle, file))) !== null;
}

function stepRowsFrom(run: LegacyRun): {
  step: PipelineStep;
  outcome: SpecStepOutcome;
  hash: string;
  tokens?: number;
  at: string | null;
}[] {
  return run.log.flatMap((row) => {
    const outcome = row.outcome as SpecStepOutcome;
    if (typeof row.step !== 'string' || row.step.length === 0) return [];
    if (!SPEC_STEP_OUTCOMES.includes(outcome)) return [];
    const hash = typeof row.hash === 'string' ? row.hash : row.artifact_hash;
    const tokens = row.tokens;
    return [
      {
        step: row.step as PipelineStep,
        outcome,
        hash: typeof hash === 'string' ? hash : '',
        ...(typeof tokens === 'number' && Number.isInteger(tokens) && tokens >= 0
          ? { tokens }
          : {}),
        at: typeof row.ts === 'string' && !Number.isNaN(Date.parse(row.ts)) ? row.ts : null,
      },
    ];
  });
}

interface LegacyCorrection {
  spec_id: string;
  changed_sections: string[];
  at: string | null;
}

function correctionsFrom(projectRoot: string, run: LegacyRun): LegacyCorrection[] {
  return readLog(projectRoot, run.name, 'corrections.jsonl').flatMap((row) => {
    if (typeof row.spec_id !== 'string' || row.spec_id.length === 0) return [];
    const sections: unknown[] = Array.isArray(row.changed_sections) ? row.changed_sections : [];
    return [
      {
        spec_id: row.spec_id,
        changed_sections: sections.filter((item): item is string => typeof item === 'string'),
        at: typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at)) ? row.at : null,
      },
    ];
  });
}

function missingCorrections(
  corrections: LegacyCorrection[],
  existing: readonly Record<string, unknown>[],
): LegacyCorrection[] {
  const rows = existing.filter((row) => row.kind === SPEC_CORRECTION_KIND);
  const used = new Set<number>();
  return corrections.filter((correction) => {
    const index = rows.findIndex(
      (row, i) =>
        !used.has(i) &&
        row.spec_id === correction.spec_id &&
        (correction.at === null
          ? JSON.stringify(row.changed_sections) === JSON.stringify(correction.changed_sections)
          : Date.parse(rowRecordedAt(row)!) === Date.parse(correction.at)),
    );
    if (index === -1) return true;
    used.add(index);
    return false;
  });
}

function frozenSpecHash(projectRoot: string, bundle: string): string | null | undefined {
  const spec = readJson(join(projectRoot, featureFilePath(bundle, 'specification')));
  if (!isRecord(spec)) return undefined;
  return typeof spec.spec_hash === 'string' ? spec.spec_hash : null;
}

interface MergePlan {
  run: LegacyRun;
  bundle: string;
  created: boolean;
  request: string | null;
  label: LabelArtifact | null;
  questions: QuestionsArtifact | null;
  experts: boolean;
  specMd: string | null;
  steps: ReturnType<typeof stepRowsFrom>;
  corrections: LegacyCorrection[];
  staged: StagedFile[];
  removable: string[];
  leftovers: string[];
}

function stepKey(step: unknown, hash: unknown): string {
  return `${String(step)}\0${typeof hash === 'string' ? hash : ''}`;
}

function missingSteps(
  steps: ReturnType<typeof stepRowsFrom>,
  existing: readonly Record<string, unknown>[],
): ReturnType<typeof stepRowsFrom> {
  const have = new Map<string, number>();
  for (const row of existing) {
    if (row.kind !== 'spec-step') continue;
    const key = stepKey(row.step, row.artifact_hash);
    have.set(key, (have.get(key) ?? 0) + 1);
  }
  return steps.filter((step) => {
    const key = stepKey(step.step, step.hash);
    const count = have.get(key) ?? 0;
    if (count === 0) return true;
    have.set(key, count - 1);
    return false;
  });
}

function planMerge(
  projectRoot: string,
  run: LegacyRun,
  bundle: string,
  created: boolean,
): MergePlan {
  const read = (file: string): string | null => readText(pipelinePath(projectRoot, run.name, file));
  const json = (file: string): unknown => readJson(pipelinePath(projectRoot, run.name, file));
  const has = (file: FeatureBundleFile): boolean =>
    !created && bundleHas(projectRoot, bundle, file);

  const request = read('request.md');
  const label = json('label.json');
  const questions = json('questions.json');
  const clarificationFree = !has('clarification');
  const specHash = created ? undefined : frozenSpecHash(projectRoot, bundle);
  const specSource = read('spec.md');
  const existingRows = created
    ? []
    : readUnitFile(projectRoot, featureFilePath(bundle, 'stageEvidence'));
  const staged =
    specHash === undefined
      ? STAGED_SOURCES.filter(
          ([file, source]) =>
            read(source) !== null && readStagedText(projectRoot, bundle, file) === null,
        ).map(([file]) => file)
      : [];

  const accounted = (rel: string): boolean => {
    const [top, name, ...rest] = rel.split('/');
    if (top !== PIPELINE_DIR || name === undefined) return false;
    if (name === RETIRED_BRIEFS_DIR) return rest.length === 1 && rest[0]!.endsWith('.md');
    if (rest.length > 0) return false;
    if (MERGED_SOURCES.includes(name) || RETIRED_SOURCES.includes(name)) return true;
    if (RETIRED_REDO.test(name)) return true;
    const stagedFile = STAGED_SOURCES.find(([, source]) => source === name)?.[0];
    if (stagedFile === undefined) return false;
    if (specHash !== undefined) {
      if (stagedFile !== 'craft') return true;
      return typeof specHash === 'string' && sha256Hex(read(name)!) === specHash;
    }
    return (
      staged.includes(stagedFile) || readStagedText(projectRoot, bundle, stagedFile) === read(name)
    );
  };
  const files = listFilesUnder(join(projectRoot, LEGACY_SPECS_DIR, run.name));

  return {
    run,
    bundle,
    created,
    request: request !== null && !has('request') ? splitFrontMatter(request).body : null,
    label: isRecord(label) && clarificationFree ? (label as unknown as LabelArtifact) : null,
    questions:
      isRecord(questions) && Array.isArray(questions.questions) && clarificationFree
        ? (questions as unknown as QuestionsArtifact)
        : null,
    experts: isRecord(json('experts.json')) && !has('experts'),
    specMd:
      typeof specHash === 'string' &&
      specSource !== null &&
      !has('specMd') &&
      sha256Hex(specSource) === specHash
        ? specSource
        : null,
    steps: missingSteps(stepRowsFrom(run), existingRows),
    corrections: missingCorrections(correctionsFrom(projectRoot, run), existingRows),
    staged,
    removable: files.filter(accounted),
    leftovers: files.filter((rel) => !accounted(rel)),
  };
}

function describeAdds(plan: MergePlan): string[] {
  const added: string[] = [];
  if (plan.created) added.push('feature.json');
  if (plan.request !== null) added.push('request.md');
  if (plan.label || plan.questions) added.push('clarification.json');
  if (plan.experts) added.push('experts.json');
  if (plan.specMd !== null) added.push('spec.md');
  const rows = plan.steps.length + plan.corrections.length + (plan.created ? 1 : 0);
  if (rows > 0) {
    added.push(`stage-evidence.jsonl (+${rows} row${rows === 1 ? '' : 's'})`);
  }
  return added;
}

function briefFacts(text: string | null): { budget: number; truncated: boolean; hash: string } {
  if (text === null) return { budget: 0, truncated: false, hash: '' };
  const budget = /^- Granted budget: (\d+) tokens$/m.exec(text);
  return {
    budget: budget ? Number(budget[1]) : 0,
    truncated: /^- Grounding truncated: yes$/m.test(text),
    hash: sha256Hex(text),
  };
}

function writeExperts(projectRoot: string, plan: MergePlan): void {
  const json = (file: string): unknown => readJson(pipelinePath(projectRoot, plan.run.name, file));
  const need = json('experts.json') as { experts?: { role: AgentRole; reason: string }[] };
  const notes = json('expert-notes.json');
  const roster: ExpertRosterEntry[] = (need.experts ?? []).map(({ role, reason }) => {
    const brief = briefFacts(
      readText(pipelinePath(projectRoot, plan.run.name, join('briefs', `${role}.md`))),
    );
    return {
      role,
      reason,
      lens: lensPathForRole(role),
      budget_tokens: brief.budget,
      grounding_truncated: brief.truncated,
      brief_hash: brief.hash,
      tokens_used: null,
    };
  });
  writeExpertRoster(projectRoot, plan.bundle, roster);
  if (isRecord(notes) && Array.isArray(notes.notes)) {
    const artifact: ExpertNotesArtifact = {
      notes: (notes.notes as ExpertNotesArtifact['notes']).map(({ role, findings }) => ({
        role,
        findings,
      })),
      tokens: isRecord(notes.tokens) ? (notes.tokens as ExpertNotesArtifact['tokens']) : {},
    };
    writeExpertNotes(projectRoot, plan.bundle, artifact);
  }
  const synthesis = json('expert-synthesis.json');
  if (isRecord(synthesis)) {
    writeExpertSynthesis(projectRoot, plan.bundle, synthesis as unknown as ExpertSynthesis);
  }
}

function applyMerge(projectRoot: string, plan: MergePlan): void {
  const { bundle } = plan;
  if (plan.created) {
    seedFeatureRecord(projectRoot, bundle, {
      adapter: UNKNOWN,
      sessionId: UNKNOWN,
      status: 'spec-only',
    });
  }
  if (plan.request !== null) writeRequest(projectRoot, bundle, plan.request);
  if (plan.label) writeLabel(projectRoot, bundle, plan.label);
  if (plan.questions) writeQuestions(projectRoot, bundle, plan.questions);
  if (plan.experts) writeExperts(projectRoot, plan);
  if (plan.specMd !== null) {
    const header = buildTextHeader({
      docType: SPEC_SOURCE_DOC_TYPE,
      change: featureChangeKey(bundle),
      sessionId: documentSessionId(projectRoot, bundle),
      schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
      body: plan.specMd,
    });
    atomicWrite(
      join(projectRoot, featureFilePath(bundle, 'specMd')),
      renderFrontMatter(header, plan.specMd),
    );
  }
  for (const step of plan.steps) {
    appendSpecStepRow(
      projectRoot,
      bundle,
      {
        step: step.step,
        outcome: step.outcome,
        artifactHash: step.hash,
        ...(step.tokens !== undefined ? { tokens: step.tokens } : {}),
      },
      step.at === null ? {} : { now: () => new Date(step.at!) },
    );
  }
  for (const correction of plan.corrections) {
    appendSpecCorrectionRow(
      projectRoot,
      bundle,
      { spec_id: correction.spec_id, changed_sections: correction.changed_sections },
      correction.at === null ? {} : { now: () => new Date(correction.at!) },
    );
  }
  for (const file of plan.staged) {
    const source = STAGED_SOURCES.find(([staged]) => staged === file)![1];
    writeStagedText(
      projectRoot,
      bundle,
      file,
      readText(pipelinePath(projectRoot, plan.run.name, source))!,
    );
  }
  if (plan.created) {
    appendFeatureStageRow(projectRoot, UNKNOWN, bundle, {
      kind: 'close',
      event_status: 'completed',
      note: 'spec-only: the spec ran but the change never opened (evidence migration)',
    });
  }
}

function strayTmpFiles(projectRoot: string, runs: LegacyRun[], bundles: string[]): string[] {
  const tmpRoot = join(projectRoot, '.paqad', 'tmp');
  const stagingName = SPEC_PIPELINE_STAGING_DIR.split('/').pop()!;
  const prefixes = new Set<string>();
  const ulids = new Set<string>();
  const contents = new Set<string>();
  for (const name of [...runs.map((run) => run.name), ...bundles]) {
    const parts = parseFeatureDirName(name)!;
    ulids.add(parts.ulid);
    if (parts.slug !== 'change') {
      prefixes.add(parts.slug);
      if (parts.issue) prefixes.add(`${parts.issue}-${parts.slug}`);
    }
  }
  for (const run of runs) {
    for (const entry of listEntries(join(projectRoot, LEGACY_SPECS_DIR, run.name, PIPELINE_DIR))) {
      const text = entry.dir ? null : readText(pipelinePath(projectRoot, run.name, entry.name));
      if (text !== null) contents.add(sha256Hex(text));
    }
  }
  return listEntries(tmpRoot)
    .filter((entry) => !entry.dir && entry.name !== stagingName)
    .filter((entry) => {
      const named =
        [...ulids].some((ulid) => entry.name.includes(ulid)) ||
        [...prefixes].some(
          (prefix) => entry.name.startsWith(`${prefix}-`) || entry.name.startsWith(`${prefix}.`),
        );
      if (named) return true;
      const text = readText(join(tmpRoot, entry.name));
      return text !== null && contents.has(sha256Hex(text));
    })
    .map((entry) => `.paqad/tmp/${entry.name}`)
    .sort();
}

function gitignoreWithoutSpecsLine(projectRoot: string): { path: string; next: string } | null {
  const path = join(projectRoot, '.paqad', '.gitignore');
  const text = readText(path);
  if (text === null) return null;
  const lines = text.split('\n');
  const kept = lines.filter((line) => line.trim() !== LEGACY_SPECS_IGNORE_LINE);
  return kept.length === lines.length ? null : { path, next: kept.join('\n') };
}

function specsDirExists(projectRoot: string): boolean {
  try {
    return statSync(join(projectRoot, LEGACY_SPECS_DIR)).isDirectory();
  } catch {
    return false;
  }
}

export function migrateFeatureEvidence(
  projectRoot: string,
  options: EvidenceMigrationOptions = {},
): EvidenceMigrationResult {
  const dryRun = options.dryRun === true;
  const hold: HoldCheck = {
    self: options.sessionId?.trim() || null,
    staleAfterMs: options.staleAfterMs ?? HELD_SESSION_STALE_MS,
    nowMs: (options.now ?? (() => new Date()))().getTime(),
  };
  const actions: EvidenceMigrationAction[] = [];
  const leftBehind: string[] = [];
  const specsRel = (rel: string): string => `${LEGACY_SPECS_DIR}/${rel}`;

  const byUlid = new Map<string, LegacyRun[]>();
  for (const entry of listEntries(join(projectRoot, LEGACY_SPECS_DIR))) {
    if (!entry.dir || !isFeatureDirName(entry.name)) {
      actions.push({ kind: 'skip-unrecognized', source: entry.name });
      leftBehind.push(specsRel(entry.name));
      continue;
    }
    const run = readRun(projectRoot, entry.name);
    byUlid.set(run.ulid, [...(byUlid.get(run.ulid) ?? []), run]);
  }

  const bundles = listFeatureDirs(projectRoot);
  const merged: MergePlan[] = [];
  const dropped: LegacyRun[] = [];
  for (const [ulid, runs] of [...byUlid.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const kept = pickRun(runs);
    const existing = bundles.find((name) => featureChangeKey(name) === ulid);
    if (existing && heldByAnotherSession(projectRoot, existing, hold)) {
      for (const run of runs) {
        actions.push({ kind: 'skip-held', source: run.name, bundle: existing });
        leftBehind.push(specsRel(run.name));
      }
      continue;
    }
    const bundle = existing ?? kept.name;
    try {
      const plan = planMerge(projectRoot, kept, bundle, existing === undefined);
      if (!dryRun) applyMerge(projectRoot, plan);
      actions.push({
        kind: 'merge',
        source: kept.name,
        bundle,
        created: plan.created,
        added: describeAdds(plan),
        staged: [...plan.staged],
      });
      if (plan.leftovers.length > 0) {
        actions.push({ kind: 'leave-files', source: kept.name, files: [...plan.leftovers] });
        leftBehind.push(...plan.leftovers.map((rel) => specsRel(`${kept.name}/${rel}`)));
      }
      for (const run of runs) {
        if (run === kept) continue;
        actions.push({ kind: 'drop-duplicate', source: run.name, kept: kept.name });
        dropped.push(run);
      }
      merged.push(plan);
    } catch (error) {
      actions.push({
        kind: 'failed',
        source: kept.name,
        error: (error as Error).message,
      });
      leftBehind.push(specsRel(kept.name));
    }
  }

  const remove = (rel: string, recursive: boolean): void => {
    try {
      rmSync(join(projectRoot, rel), { recursive, force: true });
    } catch (error) {
      actions.push({ kind: 'delete-failed', path: rel, error: (error as Error).message });
      if (rel.startsWith(`${LEGACY_SPECS_DIR}/`)) leftBehind.push(rel);
    }
  };

  const stray = strayTmpFiles(
    projectRoot,
    [...merged.map((plan) => plan.run), ...dropped],
    merged.map((plan) => plan.bundle),
  );
  for (const path of stray) actions.push({ kind: 'delete-tmp', path });
  if (!dryRun) {
    for (const path of stray) remove(path, false);
    for (const run of dropped) remove(specsRel(run.name), true);
    for (const plan of merged) {
      const runRel = specsRel(plan.run.name);
      if (plan.leftovers.length === 0) {
        remove(runRel, true);
        continue;
      }
      for (const rel of plan.removable) remove(`${runRel}/${rel}`, false);
      pruneEmptyDirs(join(projectRoot, runRel));
    }
  }

  const specsDir = specsDirExists(projectRoot);
  if (specsDir && leftBehind.length === 0) {
    actions.push({ kind: 'remove-specs-dir' });
    if (!dryRun) remove(LEGACY_SPECS_DIR, true);
  }
  if (!specsDir || leftBehind.length === 0) {
    const gitignore = gitignoreWithoutSpecsLine(projectRoot);
    if (gitignore) {
      actions.push({ kind: 'remove-gitignore-line' });
      if (!dryRun) atomicWrite(gitignore.path, gitignore.next);
    }
  }

  return { dryRun, actions, leftBehind: [...new Set(leftBehind)].sort() };
}

function pruneEmptyDirs(abs: string): void {
  for (const entry of listEntries(abs)) {
    if (entry.dir) pruneEmptyDirs(join(abs, entry.name));
  }
  try {
    rmdirSync(abs);
  } catch {}
}

export function migrationSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.SE_SESSION ?? env.CLAUDE_SESSION_ID ?? null;
}

export function legacyEvidenceIgnoreEntries(projectRoot: string): string[] {
  return specsDirExists(projectRoot) ? [LEGACY_SPECS_IGNORE_LINE] : [];
}

export function evidenceMigrationPending(projectRoot: string): boolean {
  return specsDirExists(projectRoot);
}

export function runPendingEvidenceMigration(
  projectRoot: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
  env: NodeJS.ProcessEnv = process.env,
): EvidenceMigrationResult | null {
  if (!evidenceMigrationPending(projectRoot)) return null;
  try {
    return migrateFeatureEvidence(projectRoot, { sessionId: migrationSessionId(env) });
  } catch (error) {
    warn(
      `paqad: the evidence migration did not finish (${(error as Error).message}); ` +
        'it runs again on the next update, or run `paqad-ai evidence migrate`.',
    );
    return null;
  }
}

export function formatEvidenceMigration(result: EvidenceMigrationResult): string {
  if (result.actions.length === 0) return 'Nothing to migrate: the evidence layout is current.';
  const verb = result.dryRun ? 'would' : 'did';
  const lines = result.actions.map((action) => {
    switch (action.kind) {
      case 'merge': {
        const into = action.created ? `a new spec-only bundle ${action.bundle}` : action.bundle;
        const added = action.added.length > 0 ? action.added.join(', ') : 'nothing new';
        const staged =
          action.staged.length > 0 ? `; staged ${action.staged.join(', ')} for a later freeze` : '';
        return `merge ${action.source} into ${into}: add ${added}${staged}`;
      }
      case 'drop-duplicate':
        return `delete ${action.source} (a half run; kept ${action.kept})`;
      case 'skip-held':
        return `skip ${action.source}: ${action.bundle} is open in another session (migrated once it closes)`;
      case 'skip-unrecognized':
        return `leave ${action.source}: not a change folder`;
      case 'failed':
        return `leave ${action.source}: migration failed (${action.error})`;
      case 'leave-files':
        return `leave ${action.files.join(', ')} in ${LEGACY_SPECS_DIR}/${action.source}/: not merged, so kept for you to check`;
      case 'delete-failed':
        return `could not delete ${action.path} (${action.error}); it stays for a later run`;
      case 'delete-tmp':
        return `delete ${action.path}`;
      case 'remove-specs-dir':
        return `delete ${LEGACY_SPECS_DIR}/`;
      case 'remove-gitignore-line':
        return `remove the ${LEGACY_SPECS_IGNORE_LINE} line from .paqad/.gitignore`;
    }
  });
  return [`Evidence migration (${verb}):`, ...lines.map((line) => `- ${line}`)].join('\n');
}
