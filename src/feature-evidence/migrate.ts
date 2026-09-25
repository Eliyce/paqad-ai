// The one-time evidence migration (issue #581, FR-12).
//
// Before #581 the spec pipeline kept its run under `.paqad/_specs/<change>/pipeline/`, a
// git-ignored scratch folder beside the bundle, and the record verbs were handed inputs under
// `.paqad/tmp/`. Since #581 every fact lands in the change's bundle as the verb that owns it
// runs, so an existing project still carries the old folders. This module moves them over, and
// it is the only source module that names the old folder at all (AC-22).
//
// The four cases from the issue:
//   A. `_specs/<dir>` with a bundle of the same ULID: merge the run into that bundle.
//   B. `_specs/change-<ULID>` next to a renamed `_specs/<issue>-<slug>-<ULID>`: a half run a
//      rename left behind. Keep the renamed run when its log has a `finish` step, else the run
//      with more completed steps; delete the other.
//   C. `_specs/<dir>` with no bundle: create one under the same name, `feature.json`
//      `status: "spec-only"`, and merge the run in. A close row goes on it too, so no session
//      ever adopts it as a change in flight.
//   D. Files in `.paqad/tmp/` named for a migrated change (its slug or ULID), or byte-identical
//      to one of its pipeline files: the old record-verb inputs. Deleted.
// Then `.paqad/_specs/` goes, and its line leaves the managed `.paqad/.gitignore`.
//
// What a merge writes, per the issue's table, and only when the bundle does not have it yet:
// `request.md`, `clarification.json` (label, questions), `experts.json` (roster, findings,
// synthesis; `expert-merge.json` and the brief files are dropped, the brief's budget, truncation
// and hash go on the roster entry), one `spec-step` row per logged step (at its original time),
// and `spec.md`, copied in when its sha256 equals the frozen `spec_hash`. The pre-freeze working
// state (task, trace, grounding, finish, the working spec) only belongs in `specification.json`
// at freeze. A bundle already frozen keeps its record as it is; a run that never froze gets
// that state in its staging dir, exactly where a run started today keeps it, so a later
// `spec freeze --from-pipeline` still works.
//
// Sealed history is never rewritten (AC-19): the migration only ADDS files to a bundle, and the
// one file it appends to (`stage-evidence.jsonl`) keeps every existing byte. It never touches
// `evidence.jsonl` or `receipt.json`, so an old receipt still verifies. New files carry the new
// header, because they are written by the same writers a live run uses.
//
// A bundle whose change is open in ANOTHER session is left alone (AC-28): that session may still
// be writing to it. Its run stays in `_specs/`, so `_specs/` stays too, and a later run migrates
// it once the change closes. A hold goes stale once that session has not touched its control
// or the bundle for {@link HELD_SESSION_STALE_MS} (a day): a session that crashed or was closed
// never releases its control, and without the limit its change would never migrate.
//
// After a merge only the files the migration knows are removed: the ones it merged, the ones the
// bundle already had, and the retired ones (the merge file, the briefs, a frozen run's working
// state). Anything else in the run, such as a `spec.md` edited after the freeze or a file this
// module has never heard of, stays where it is, and so does `_specs/`; the result names it in
// `leftBehind`. Every step is idempotent: a second run finds nothing left to do (beyond naming
// what it left behind again). A run that fails to migrate is reported and left in place, never
// half-deleted, and a file the OS will not let go of (Windows EBUSY/EPERM) is reported too.

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
import { SPEC_STEP_OUTCOMES, type SpecStepOutcome } from '@/stage-evidence/types.js';

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

/** The retired per-change scratch folder (project-relative). Named here and nowhere else. */
export const LEGACY_SPECS_DIR = '.paqad/_specs';

/** The line the managed `.paqad/.gitignore` carried for it. */
const LEGACY_SPECS_IGNORE_LINE = '_specs/';

/** The folder inside a run that held the pipeline files. */
const PIPELINE_DIR = 'pipeline';

/** The session id a record carries when the migration cannot know who wrote it. */
const UNKNOWN = 'unknown';

/** The old pipeline file the staged working state is copied from, per staged file. */
const STAGED_SOURCES: readonly [StagedFile, string][] = [
  ['task', 'task.json'],
  ['trace', 'trace.json'],
  ['grounding', 'grounding.json'],
  ['finish', 'finish.json'],
  ['craft', 'spec.md'],
];

/** Pipeline files a merge carries into the bundle (or finds the bundle already has). */
const MERGED_SOURCES = [
  'log.jsonl',
  'request.md',
  'label.json',
  'questions.json',
  'experts.json',
  'expert-notes.json',
  'expert-synthesis.json',
];

/** Pipeline files the new layout retires: nothing reads them, so a merge drops them. */
const RETIRED_SOURCES = ['expert-merge.json'];

/** The folder of per-expert brief files, retired with them (their facts go on the roster). */
const RETIRED_BRIEFS_DIR = 'briefs';

/**
 * How long a session may sit idle before its hold on a change goes stale (24 hours). Measured
 * from the later of its control's `updated_at` and its newest row in the bundle.
 */
export const HELD_SESSION_STALE_MS = 24 * 60 * 60 * 1000;

export interface EvidenceMigrationOptions {
  /** The session running the migration: its own open changes are not "another session's". */
  sessionId?: string | null;
  /** Plan only: write and delete nothing. */
  dryRun?: boolean;
  /** How long a session may be idle before its hold goes stale. Default {@link HELD_SESSION_STALE_MS}. */
  staleAfterMs?: number;
  /** The clock the stale check reads; a seam for tests. */
  now?: () => Date;
}

/** One thing the migration did (or, on a dry run, would do). */
export type EvidenceMigrationAction =
  | {
      kind: 'merge';
      /** The `_specs/<dir>` name the run came from. */
      source: string;
      /** The bundle it merged into. */
      bundle: string;
      /** True when the bundle was created for it (case C). */
      created: boolean;
      /** Bundle files added, plus `stage-evidence.jsonl (+N spec-step rows)` when rows were. */
      added: string[];
      /** Staged working-state files written for a run that never froze. */
      staged: string[];
    }
  | { kind: 'drop-duplicate'; source: string; kept: string }
  | { kind: 'skip-held'; source: string; bundle: string }
  | { kind: 'skip-unrecognized'; source: string }
  | { kind: 'failed'; source: string; error: string }
  /** A merged run's files the migration did not merge: kept in `_specs/<source>/`. */
  | { kind: 'leave-files'; source: string; files: string[] }
  /** A delete the OS refused (a Windows lock, say): the path stays and the update goes on. */
  | { kind: 'delete-failed'; path: string; error: string }
  | { kind: 'delete-tmp'; path: string }
  | { kind: 'remove-specs-dir' }
  | { kind: 'remove-gitignore-line' };

export interface EvidenceMigrationResult {
  dryRun: boolean;
  actions: EvidenceMigrationAction[];
  /**
   * Project-relative paths that stay under `.paqad/_specs/` after this run: a held or failed
   * run's folder, an entry that is not a change folder, a merged run's unmerged files, or a
   * path a delete could not remove. Empty once the old folder is gone.
   */
  leftBehind: string[];
}

// ── Reading the old layout ──────────────────────────────────────────────────────────────

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

/** Every file under `abs`, as posix paths relative to it, sorted. */
function listFilesUnder(abs: string, prefix = ''): string[] {
  return listEntries(abs)
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.dir ? listFilesUnder(join(abs, entry.name), rel) : [rel];
    })
    .sort();
}

/** One old run: its `_specs/<dir>` name and its log rows. */
interface LegacyRun {
  name: string;
  ulid: string;
  log: Record<string, unknown>[];
}

function pipelinePath(projectRoot: string, run: string, file: string): string {
  return join(projectRoot, LEGACY_SPECS_DIR, run, PIPELINE_DIR, file);
}

/** An old run's `log.jsonl`: plain rows with no envelope, a corrupt line skipped. */
function readLog(projectRoot: string, run: string): Record<string, unknown>[] {
  const raw = readText(pipelinePath(projectRoot, run, 'log.jsonl')) ?? '';
  return raw.split('\n').flatMap((line) => {
    try {
      const row: unknown = JSON.parse(line);
      return isRecord(row) ? [row] : [];
    } catch {
      return []; // a blank or partial line
    }
  });
}

function readRun(projectRoot: string, name: string): LegacyRun {
  return { name, ulid: featureChangeKey(name), log: readLog(projectRoot, name) };
}

/** The distinct steps a run's log marks complete. */
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

/**
 * Case B: of several runs for one ULID, the one to keep. A renamed run whose log reached
 * `finish` wins; otherwise the run with more completed steps, a renamed run on a tie.
 */
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

// ── Session ownership ───────────────────────────────────────────────────────────────────

/** True when the bundle carries a `close` row: its change is finished, whoever held it. */
function bundleClosed(projectRoot: string, bundle: string): boolean {
  return readUnitFile(projectRoot, featureFilePath(bundle, 'stageEvidence')).some(
    (row) => row.kind === 'close',
  );
}

/** The session's last sign of life for `bundle`: its control's stamp or its newest row there. */
function lastSeenMs(updatedAt: string, rows: Record<string, unknown>[], sessionId: string): number {
  const times = [
    Date.parse(updatedAt),
    ...rows
      .filter((row) => row.session_id === sessionId)
      // A readable ledger row always carries one of its two time fields.
      .map((row) => Date.parse(rowRecordedAt(row)!)),
  ].filter((time) => !Number.isNaN(time));
  return times.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...times);
}

interface HoldCheck {
  self: string | null;
  staleAfterMs: number;
  nowMs: number;
}

/**
 * Whether a session other than `self` has `bundle` open (active or paused), its change has not
 * closed, and that session was seen within the stale limit (AC-28). Read from the per-session
 * controls, the one place an open change is held.
 */
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

// ── Planning one merge ──────────────────────────────────────────────────────────────────

function bundleHas(projectRoot: string, bundle: string, file: FeatureBundleFile): boolean {
  return readText(join(projectRoot, featureFilePath(bundle, file))) !== null;
}

/** The logged steps that map onto a `spec-step` row; a row with an unknown outcome is dropped. */
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
        // The row keeps the time the step ran; an unreadable one takes the migration's clock.
        at: typeof row.ts === 'string' && !Number.isNaN(Date.parse(row.ts)) ? row.ts : null,
      },
    ];
  });
}

/** The frozen `spec_hash` of a bundle's specification.json, null when unfrozen; undefined when absent. */
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
  staged: StagedFile[];
  /** The run's files (relative to `_specs/<run>/`) that are merged, covered or retired. */
  removable: string[];
  /** The run's files the migration did not merge, which stay where they are. */
  leftovers: string[];
}

/** The key a `spec-step` row is matched on across a retry: its step and artifact hash. */
function stepKey(step: unknown, hash: unknown): string {
  return `${String(step)}\0${typeof hash === 'string' ? hash : ''}`;
}

/**
 * The logged steps the bundle does not have a row for yet. Matched per step and hash, counting
 * repeats, so a merge interrupted part way through writes only the rows it had not written.
 */
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
  // A run that never froze keeps its working state in staging, as a run started today would.
  const staged =
    specHash === undefined
      ? STAGED_SOURCES.filter(
          ([file, source]) =>
            read(source) !== null && readStagedText(projectRoot, bundle, file) === null,
        ).map(([file]) => file)
      : [];

  // Which of the run's files the merge accounts for. A frozen run's working state is retired
  // (its facts are in specification.json), except a `spec.md` that is not the signed source.
  // A run that never froze accounts for a staged file once staging holds exactly its bytes.
  const accounted = (rel: string): boolean => {
    const [top, name, ...rest] = rel.split('/');
    if (top !== PIPELINE_DIR || name === undefined) return false;
    if (name === RETIRED_BRIEFS_DIR) return rest.length === 1 && rest[0]!.endsWith('.md');
    if (rest.length > 0) return false;
    if (MERGED_SOURCES.includes(name) || RETIRED_SOURCES.includes(name)) return true;
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
  if (plan.steps.length > 0 || plan.created) {
    const rows = plan.steps.length + (plan.created ? 1 : 0);
    added.push(`stage-evidence.jsonl (+${rows} row${rows === 1 ? '' : 's'})`);
  }
  return added;
}

// ── Applying one merge ──────────────────────────────────────────────────────────────────

/** A brief's recorded budget and truncation, read back from its rendered header lines. */
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
    // The notes' questions were merged into the question round long ago, so only the findings
    // and the reported tokens carry over; nothing is staged for a question round again.
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
    // The spec ran but the change never opened: close it, so no session adopts it as in flight.
    appendFeatureStageRow(projectRoot, UNKNOWN, bundle, {
      kind: 'close',
      event_status: 'completed',
      note: 'spec-only: the spec ran but the change never opened (evidence migration)',
    });
  }
}

// ── Case D: stray tmp inputs ────────────────────────────────────────────────────────────

/** Top-level `.paqad/tmp/` files that belong to a migrated run (case D). */
function strayTmpFiles(projectRoot: string, runs: LegacyRun[], bundles: string[]): string[] {
  const tmpRoot = join(projectRoot, '.paqad', 'tmp');
  const stagingName = SPEC_PIPELINE_STAGING_DIR.split('/').pop()!;
  const prefixes = new Set<string>();
  const ulids = new Set<string>();
  const contents = new Set<string>();
  for (const name of [...runs.map((run) => run.name), ...bundles]) {
    const parts = parseFeatureDirName(name)!;
    ulids.add(parts.ulid);
    // `change` alone is too generic to name a change: only its ULID does.
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

// ── The managed .gitignore line ─────────────────────────────────────────────────────────

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

// ── Entry points ────────────────────────────────────────────────────────────────────────

/**
 * Migrate a project's old evidence layout to the #581 one (cases A to D), or with `dryRun`
 * only report what that would do. Idempotent, and it never throws on one bad run: a run that
 * fails is reported as `failed` and left where it is.
 */
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

  // A delete the OS refuses is reported and left, never allowed to stop the run (or an update).
  const remove = (rel: string, recursive: boolean): void => {
    try {
      rmSync(join(projectRoot, rel), { recursive, force: true });
    } catch (error) {
      actions.push({ kind: 'delete-failed', path: rel, error: (error as Error).message });
      if (rel.startsWith(`${LEGACY_SPECS_DIR}/`)) leftBehind.push(rel);
    }
  };

  // Case D reads the runs' bytes, so it is planned before any run folder is deleted.
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
      // Only the files the merge accounts for go; the folders they leave empty go with them.
      for (const rel of plan.removable) remove(`${runRel}/${rel}`, false);
      pruneEmptyDirs(join(projectRoot, runRel));
    }
  }

  const specsDir = specsDirExists(projectRoot);
  if (specsDir && leftBehind.length === 0) {
    actions.push({ kind: 'remove-specs-dir' });
    if (!dryRun) remove(LEGACY_SPECS_DIR, true);
  }
  // The ignore line stays while the folder does, so nothing in it can ever be committed.
  if (!specsDir || leftBehind.length === 0) {
    const gitignore = gitignoreWithoutSpecsLine(projectRoot);
    if (gitignore) {
      actions.push({ kind: 'remove-gitignore-line' });
      if (!dryRun) atomicWrite(gitignore.path, gitignore.next);
    }
  }

  return { dryRun, actions, leftBehind: [...new Set(leftBehind)].sort() };
}

/** Remove the empty folders under `abs` (deepest first), and `abs` itself once it is empty. */
function pruneEmptyDirs(abs: string): void {
  for (const entry of listEntries(abs)) {
    if (entry.dir) pruneEmptyDirs(join(abs, entry.name));
  }
  try {
    rmdirSync(abs);
  } catch {
    // Not empty (a file was left behind) or already gone: either way it stays as it is.
  }
}

/** The session a migration runs as: the host's, when it exported one. */
export function migrationSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.SE_SESSION ?? env.CLAUDE_SESSION_ID ?? null;
}

/**
 * The managed `.paqad/.gitignore` lines the old layout still needs: the old folder's line for
 * as long as the folder is there (a held run, a file the migration left), none once it is gone.
 * The ignore writer adds these, so a re-onboard never un-ignores a folder that still has files.
 */
export function legacyEvidenceIgnoreEntries(projectRoot: string): string[] {
  return specsDirExists(projectRoot) ? [LEGACY_SPECS_IGNORE_LINE] : [];
}

/** True when the project still carries the old scratch folder, so a migration run has work. */
export function evidenceMigrationPending(projectRoot: string): boolean {
  return specsDirExists(projectRoot);
}

/**
 * The pending-migration step `update` and onboarding both run: migrate when the old folder is
 * still there (a change another session held last time, or a project stamped before it had any
 * migration). It never throws: a failure is passed to `warn` and the caller carries on, so a
 * locked file on Windows cannot stop an update. Null when there was nothing to do or it failed.
 */
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

/** One plain line per action, for the CLI and the schema-migration note. */
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
