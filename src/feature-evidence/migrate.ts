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
// it once the change closes. Every step is idempotent: a second run finds nothing left to do.
// A run that fails to migrate is reported and left in place, never half-deleted.

import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';

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
import { buildTextHeader, renderFrontMatter, splitFrontMatter } from './envelope.js';
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

export interface EvidenceMigrationOptions {
  /** The session running the migration: its own open changes are not "another session's". */
  sessionId?: string | null;
  /** Plan only: write and delete nothing. */
  dryRun?: boolean;
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
  | { kind: 'delete-tmp'; path: string }
  | { kind: 'remove-specs-dir' }
  | { kind: 'remove-gitignore-line' };

export interface EvidenceMigrationResult {
  dryRun: boolean;
  actions: EvidenceMigrationAction[];
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

/**
 * Whether a session other than `self` has `bundle` open (active or paused) and its change has
 * not closed (AC-28). Read from the per-session controls, the one place an open change is held.
 */
function heldByAnotherSession(projectRoot: string, bundle: string, self: string | null): boolean {
  if (bundleClosed(projectRoot, bundle)) return false;
  for (const entry of listEntries(join(projectRoot, PATHS.FEATURE_EVIDENCE_SESSION_DIR))) {
    if (entry.dir || !entry.name.endsWith('.json')) continue;
    const sessionId = entry.name.slice(0, -'.json'.length);
    if (sessionId === self) continue;
    const control = readSessionControl(projectRoot, sessionId);
    if (control.active === bundle || control.paused.includes(bundle)) return true;
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
  const hasStepRows =
    !created &&
    readUnitFile(projectRoot, featureFilePath(bundle, 'stageEvidence')).some(
      (row) => row.kind === 'spec-step',
    );
  // A run that never froze keeps its working state in staging, as a run started today would.
  const staged =
    specHash === undefined
      ? STAGED_SOURCES.filter(
          ([file, source]) =>
            read(source) !== null && readStagedText(projectRoot, bundle, file) === null,
        ).map(([file]) => file)
      : [];

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
    steps: hasStepRows ? [] : stepRowsFrom(run),
    staged,
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
  const self = options.sessionId?.trim() || null;
  const actions: EvidenceMigrationAction[] = [];
  let leftBehind = false;

  const byUlid = new Map<string, LegacyRun[]>();
  for (const entry of listEntries(join(projectRoot, LEGACY_SPECS_DIR))) {
    if (!entry.dir || !isFeatureDirName(entry.name)) {
      actions.push({ kind: 'skip-unrecognized', source: entry.name });
      leftBehind = true;
      continue;
    }
    const run = readRun(projectRoot, entry.name);
    byUlid.set(run.ulid, [...(byUlid.get(run.ulid) ?? []), run]);
  }

  const bundles = listFeatureDirs(projectRoot);
  const migratedRuns: LegacyRun[] = [];
  const migratedBundles: string[] = [];
  for (const [ulid, runs] of [...byUlid.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const kept = pickRun(runs);
    const existing = bundles.find((name) => featureChangeKey(name) === ulid);
    if (existing && heldByAnotherSession(projectRoot, existing, self)) {
      for (const run of runs)
        actions.push({ kind: 'skip-held', source: run.name, bundle: existing });
      leftBehind = true;
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
      for (const run of runs) {
        if (run !== kept)
          actions.push({ kind: 'drop-duplicate', source: run.name, kept: kept.name });
      }
      migratedRuns.push(...runs);
      migratedBundles.push(bundle);
    } catch (error) {
      actions.push({
        kind: 'failed',
        source: kept.name,
        error: (error as Error).message,
      });
      leftBehind = true;
    }
  }

  // Case D reads the runs' bytes, so it is planned before any run folder is deleted.
  const stray = strayTmpFiles(projectRoot, migratedRuns, migratedBundles);
  for (const path of stray) actions.push({ kind: 'delete-tmp', path });
  if (!dryRun) {
    for (const path of stray) rmSync(join(projectRoot, path), { force: true });
    for (const run of migratedRuns) {
      rmSync(join(projectRoot, LEGACY_SPECS_DIR, run.name), { recursive: true, force: true });
    }
  }

  const specsDir = specsDirExists(projectRoot);
  if (specsDir && !leftBehind) {
    actions.push({ kind: 'remove-specs-dir' });
    if (!dryRun) rmSync(join(projectRoot, LEGACY_SPECS_DIR), { recursive: true, force: true });
  }
  // The ignore line stays while the folder does, so nothing in it can ever be committed.
  if (!(leftBehind && specsDir)) {
    const gitignore = gitignoreWithoutSpecsLine(projectRoot);
    if (gitignore) {
      actions.push({ kind: 'remove-gitignore-line' });
      if (!dryRun) atomicWrite(gitignore.path, gitignore.next);
    }
  }

  return { dryRun, actions };
}

/** The session a migration runs as: the host's, when it exported one. */
export function migrationSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.SE_SESSION ?? env.CLAUDE_SESSION_ID ?? null;
}

/** True when the project still carries the old scratch folder, so a migration run has work. */
export function evidenceMigrationPending(projectRoot: string): boolean {
  return specsDirExists(projectRoot);
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
