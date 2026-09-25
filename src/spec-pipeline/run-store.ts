// The spec-pipeline run store (issue #581, FR-1 / FR-8 / FR-9).
//
// This is the only place the spec pipeline reads or writes its state. There are two homes and
// no third:
//
//   - The change's bundle, for the facts that belong in the evidence packet. `request.md`
//     (front-matter header, body-only hash) at start, `clarification.json` (`label` and
//     `questions` sections) at label and questions, `experts.json` (`roster`, `findings`,
//     `synthesis`) at the three expert verbs, and one `kind: 'spec-step'` row per step on
//     `stage-evidence.jsonl`. Each is written here, through the envelope helpers, the moment
//     the verb that owns it runs.
//   - A staging dir, `.paqad/tmp/spec-pipeline/<ULID>/`, for the pre-freeze working state that
//     only belongs in `specification.json` once the spec is frozen: the grounding (with the
//     terms the plain-language checks need), the task, the trace, the working craft `spec.md`,
//     the finish result, the expert-note questions still waiting for the question round, and
//     the list of `.paqad/tmp/` inputs the record verbs were handed. It is keyed by the change
//     ULID, not the folder name, so a bundle rename leaves nothing behind. `spec freeze` merges
//     it into `specification.json` and deletes it.
//
// Nothing here creates or reads the retired per-feature scratch folder (INV-1).

import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import { dirname, join, relative, resolve } from 'pathe';

import type { AgentRole } from '@/core/types/agent.js';
import type {
  SpecGroundingSection,
  SpecPipelineSection,
  SpecTaskSection,
  SpecTraceMap,
} from '@/core/types/feature-spec.js';
import { documentSessionId, stampFeatureDocument } from '@/feature-evidence/bundle-document.js';
import {
  buildTextHeader,
  ENVELOPE_HEADER_KEYS,
  renderFrontMatter,
  splitFrontMatter,
} from '@/feature-evidence/envelope.js';
import {
  featureChangeKey,
  featureFilePath,
  type FeatureBundleFile,
} from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import {
  CLARIFICATION_DOC_TYPE,
  EXPERTS_DOC_TYPE,
  FEATURE_DOC_SCHEMA_VERSION,
  REQUEST_DOC_TYPE,
} from '@/feature-evidence/types.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  SPEC_CORRECTION_KIND,
  SPEC_STEP_KIND,
  type SpecStepOutcome,
} from '@/stage-evidence/types.js';

import type { ExpertNotesArtifact } from './experts/notes.js';
import type { ExpertSynthesis } from './experts/synthesis.js';
import type { ExpertFinding, ExpertNeedArtifact, ExpertNote } from './experts/types.js';
import { frozenPipelineSection, type QuestionCounts, type StagedFinish } from './finish.js';
import type {
  AutoAnswer,
  ClarityLabel,
  ClaritySignal,
  GroundingArtifact,
  LabelArtifact,
  PipelineQuestion,
  PipelineStep,
  QuestionsArtifact,
} from './types.js';

/** Project-relative root of every change's staging dir. */
export const SPEC_PIPELINE_STAGING_DIR = '.paqad/tmp/spec-pipeline';

/** The files a staging dir can hold, and nothing else. */
export const STAGED_FILES = {
  grounding: 'grounding.json',
  task: 'task.json',
  trace: 'trace.json',
  craft: 'spec.md',
  finish: 'finish.json',
  /** Expert-note questions waiting for the question round to merge them (FR-9). */
  expertQuestions: 'expert-questions.json',
  /** The `.paqad/tmp/` input paths the record verbs were handed, for freeze to delete (FR-4). */
  inputs: 'inputs.json',
} as const;

export type StagedFile = keyof typeof STAGED_FILES;

/** Options every bundle writer takes: the writer's session and a clock seam for tests. */
export interface StoreWriteOptions {
  sessionId?: string | null;
  now?: () => Date;
}

/** Project-relative staging dir for a change, keyed by the ULID at the end of its folder name. */
export function stagingDir(dirName: string): string {
  return join(SPEC_PIPELINE_STAGING_DIR, featureChangeKey(dirName));
}

/** Project-relative path to one staged file. */
export function stagedFilePath(dirName: string, file: StagedFile): string {
  return join(stagingDir(dirName), STAGED_FILES[file]);
}

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function atomicWrite(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, abs);
}

// ── Staging ─────────────────────────────────────────────────────────────────────────────

/** Read a staged file's text, or null when it was never written. */
export function readStagedText(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
): string | null {
  return readText(join(projectRoot, stagedFilePath(dirName, file)));
}

/** Write a staged file's text as-is. */
export function writeStagedText(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
  text: string,
): void {
  atomicWrite(join(projectRoot, stagedFilePath(dirName, file)), text);
}

/** Read a staged JSON file, or null when it is missing or malformed. */
export function readStagedJson<T>(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
): T | null {
  const raw = readStagedText(projectRoot, dirName, file);
  const parsed = raw === null ? undefined : parseJson(raw);
  return parsed === undefined ? null : (parsed as T);
}

/** Write a staged JSON file (pretty-printed, trailing newline). */
export function writeStagedJson(
  projectRoot: string,
  dirName: string,
  file: StagedFile,
  value: unknown,
): void {
  writeStagedText(projectRoot, dirName, file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Delete a staged file (a no-op when it was never written). */
export function clearStaged(projectRoot: string, dirName: string, file: StagedFile): void {
  rmSync(join(projectRoot, stagedFilePath(dirName, file)), { force: true });
}

// ── Bundle documents ────────────────────────────────────────────────────────────────────

/** A bundle document's body: the parsed JSON with its envelope header stripped. */
function readBundleBody(
  projectRoot: string,
  dirName: string,
  file: FeatureBundleFile,
): Record<string, unknown> | null {
  const raw = readText(join(projectRoot, featureFilePath(dirName, file)));
  const parsed = raw === null ? undefined : parseJson(raw);
  if (!isRecord(parsed)) return null;
  const body: Record<string, unknown> = { ...parsed };
  for (const key of ENVELOPE_HEADER_KEYS) delete body[key];
  return body;
}

/** Stamp a body with the envelope header and write it into the bundle. */
function writeBundleBody(
  projectRoot: string,
  dirName: string,
  file: FeatureBundleFile,
  docType: string,
  body: Record<string, unknown>,
  options: StoreWriteOptions,
): void {
  const doc = stampFeatureDocument({
    projectRoot,
    dirName,
    docType,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    sessionId: options.sessionId,
    body,
    now: options.now,
  });
  atomicWrite(
    join(projectRoot, featureFilePath(dirName, file)),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
}

// ── request.md ──────────────────────────────────────────────────────────────────────────

/** Write the request the run specs as `request.md`, the header in front matter (FR-5). */
export function writeRequest(
  projectRoot: string,
  dirName: string,
  text: string,
  options: StoreWriteOptions = {},
): void {
  const header = buildTextHeader({
    docType: REQUEST_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId: documentSessionId(projectRoot, dirName, options.sessionId),
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    body: text,
    now: options.now,
  });
  atomicWrite(
    join(projectRoot, featureFilePath(dirName, 'request')),
    renderFrontMatter(header, text),
  );
}

/** The run's request text (the `request.md` body), or '' when no request was recorded. */
export function readRequest(projectRoot: string, dirName: string): string {
  const raw = readText(join(projectRoot, featureFilePath(dirName, 'request')));
  return raw === null ? '' : splitFrontMatter(raw).body;
}

// ── clarification.json ──────────────────────────────────────────────────────────────────

/** The `label` section: the S1 clarity label, the signals that fired, the question budget. */
export interface ClarificationLabel {
  value: ClarityLabel;
  signals: ClaritySignal[];
  question_budget: number;
}

/**
 * The `questions` section: the batch asked of the user, the questions the ledger answered, the
 * expert and chief questions the cap held back (`deferred`), and the counts. `counts.deferred` is
 * how many the user chose to defer, which is a different thing from the `deferred` list.
 */
export interface ClarificationQuestions {
  asked: PipelineQuestion[];
  auto_answered: AutoAnswer[];
  deferred: PipelineQuestion[];
  counts: QuestionCounts;
}

export interface ClarificationBody {
  label: ClarificationLabel | null;
  questions: ClarificationQuestions | null;
}

/** Read `clarification.json`, or null when neither section was ever written. */
export function readClarification(projectRoot: string, dirName: string): ClarificationBody | null {
  const body = readBundleBody(projectRoot, dirName, 'clarification');
  if (body === null) return null;
  return {
    label: isRecord(body.label) ? (body.label as unknown as ClarificationLabel) : null,
    questions: isRecord(body.questions)
      ? (body.questions as unknown as ClarificationQuestions)
      : null,
  };
}

function writeClarification(
  projectRoot: string,
  dirName: string,
  patch: Partial<ClarificationBody>,
  options: StoreWriteOptions,
): void {
  const current = readClarification(projectRoot, dirName) ?? { label: null, questions: null };
  writeBundleBody(
    projectRoot,
    dirName,
    'clarification',
    CLARIFICATION_DOC_TYPE,
    { ...current, ...patch },
    options,
  );
}

/** Write the S1 label into `clarification.json` (FR-9). */
export function writeLabel(
  projectRoot: string,
  dirName: string,
  label: LabelArtifact,
  options: StoreWriteOptions = {},
): void {
  writeClarification(
    projectRoot,
    dirName,
    {
      label: {
        value: label.label,
        signals: label.signals,
        question_budget: label.question_budget,
      },
    },
    options,
  );
}

/** The recorded S1 label in the step machine's shape, or null when labelling never ran. */
export function readLabel(projectRoot: string, dirName: string): LabelArtifact | null {
  const section = readClarification(projectRoot, dirName)?.label;
  if (!section) return null;
  return {
    label: section.value,
    signals: section.signals,
    question_budget: section.question_budget,
  };
}

/** Write the S2 question batch into `clarification.json` (FR-9). */
export function writeQuestions(
  projectRoot: string,
  dirName: string,
  questions: QuestionsArtifact,
  options: StoreWriteOptions = {},
): void {
  writeClarification(
    projectRoot,
    dirName,
    {
      questions: {
        asked: questions.questions,
        auto_answered: questions.auto_answered,
        deferred: questions.deferred_from_experts ?? [],
        counts: {
          asked: questions.asked,
          answered: questions.answered,
          auto_answered: questions.auto_answered.length,
          deferred: questions.deferred,
        },
      },
    },
    options,
  );
}

/** The recorded S2 batch in the step machine's shape, or null when the question round never ran. */
export function readQuestions(projectRoot: string, dirName: string): QuestionsArtifact | null {
  const section = readClarification(projectRoot, dirName)?.questions;
  if (!section) return null;
  return {
    questions: section.asked,
    auto_answered: section.auto_answered,
    asked: section.counts.asked,
    answered: section.counts.answered,
    deferred: section.counts.deferred,
    ...(section.deferred.length > 0 ? { deferred_from_experts: section.deferred } : {}),
  };
}

/** Clear one `clarification.json` section (a redo). */
export function clearClarificationSection(
  projectRoot: string,
  dirName: string,
  section: keyof ClarificationBody,
  options: StoreWriteOptions = {},
): void {
  writeClarification(projectRoot, dirName, { [section]: null }, options);
}

// ── experts.json ────────────────────────────────────────────────────────────────────────

/** One expert the run brought in (FR-8). `brief_hash` is the sha256 of the exact brief text. */
export interface ExpertRosterEntry {
  role: AgentRole;
  reason: string;
  lens: string;
  /** The token budget the run granted this expert. */
  budget_tokens: number;
  grounding_truncated: boolean;
  brief_hash: string;
  /** The tokens the expert reported spending, null until its notes are recorded. */
  tokens_used: number | null;
}

/** One expert finding as stored: its `EX-*` id, the expert that made it, then the finding. */
export interface RecordedExpertFinding extends ExpertFinding {
  id: string;
  role: AgentRole;
}

export interface ExpertsBody {
  roster: ExpertRosterEntry[];
  /** Null until `experts notes` runs; each `EX-*` finding appears here exactly once (INV-6). */
  findings: RecordedExpertFinding[] | null;
  /** Null until `experts synthesis` runs; it refers to findings by id only. */
  synthesis: ExpertSynthesis | null;
}

/** Read `experts.json`, or null when `experts record` never ran. */
export function readExperts(projectRoot: string, dirName: string): ExpertsBody | null {
  const body = readBundleBody(projectRoot, dirName, 'experts');
  if (body === null || !Array.isArray(body.roster)) return null;
  return {
    roster: body.roster as ExpertRosterEntry[],
    findings: Array.isArray(body.findings) ? (body.findings as RecordedExpertFinding[]) : null,
    synthesis: isRecord(body.synthesis) ? (body.synthesis as unknown as ExpertSynthesis) : null,
  };
}

function writeExperts(
  projectRoot: string,
  dirName: string,
  patch: Partial<ExpertsBody>,
  options: StoreWriteOptions,
): void {
  const current = readExperts(projectRoot, dirName) ?? {
    roster: [],
    findings: null,
    synthesis: null,
  };
  writeBundleBody(
    projectRoot,
    dirName,
    'experts',
    EXPERTS_DOC_TYPE,
    { ...current, ...patch },
    options,
  );
}

/** Write the roster section (`experts record`). */
export function writeExpertRoster(
  projectRoot: string,
  dirName: string,
  roster: ExpertRosterEntry[],
  options: StoreWriteOptions = {},
): void {
  writeExperts(projectRoot, dirName, { roster }, options);
}

/** The recorded roster as the need artifact the pipeline reasons over, or null before record. */
export function readExpertNeed(projectRoot: string, dirName: string): ExpertNeedArtifact | null {
  const experts = readExperts(projectRoot, dirName);
  if (experts === null) return null;
  return { experts: experts.roster.map(({ role, reason }) => ({ role, reason })) };
}

interface StagedExpertQuestions {
  notes: { role: AgentRole; questions: PipelineQuestion[] }[];
}

/**
 * Write the experts' validated notes (`experts notes`): every finding once into
 * `experts.json` findings, each expert's reported tokens onto its roster entry, and the notes'
 * questions into staging until the question round merges them (FR-9).
 */
export function writeExpertNotes(
  projectRoot: string,
  dirName: string,
  artifact: ExpertNotesArtifact,
  options: StoreWriteOptions = {},
): void {
  const findings: RecordedExpertFinding[] = artifact.notes.flatMap((note) =>
    note.findings.map(({ id, ...finding }) => ({ id: id!, role: note.role, ...finding })),
  );
  const roster = (readExperts(projectRoot, dirName)?.roster ?? []).map((entry) => ({
    ...entry,
    tokens_used: artifact.tokens[entry.role] ?? null,
  }));
  writeExperts(projectRoot, dirName, { roster, findings }, options);
  const questions = artifact.notes
    .filter((note) => (note.questions ?? []).length > 0)
    .map((note) => ({ role: note.role, questions: note.questions! }));
  if (questions.length > 0) {
    writeStagedJson(projectRoot, dirName, 'expertQuestions', { notes: questions });
  } else {
    clearStaged(projectRoot, dirName, 'expertQuestions');
  }
}

/** The expert-note questions still staged for the question round (empty when there are none). */
export function readStagedExpertQuestions(
  projectRoot: string,
  dirName: string,
): StagedExpertQuestions['notes'] {
  return (
    readStagedJson<StagedExpertQuestions>(projectRoot, dirName, 'expertQuestions')?.notes ?? []
  );
}

/**
 * The experts' notes rebuilt from `experts.json` findings, the staged questions and the roster
 * tokens, or null before `experts notes` ran. One note per expert, in the order the experts
 * first appear, so the in-memory merge sees the same notes the verb validated.
 */
export function readExpertNotes(projectRoot: string, dirName: string): ExpertNotesArtifact | null {
  const experts = readExperts(projectRoot, dirName);
  if (experts === null || experts.findings === null) return null;
  const byRole = new Map<AgentRole, ExpertNote>();
  const noteFor = (role: AgentRole): ExpertNote => {
    const existing = byRole.get(role);
    if (existing) return existing;
    const created: ExpertNote = { role, findings: [] };
    byRole.set(role, created);
    return created;
  };
  for (const { role, ...finding } of experts.findings) noteFor(role).findings.push(finding);
  for (const { role, questions } of readStagedExpertQuestions(projectRoot, dirName)) {
    noteFor(role).questions = questions;
  }
  const tokens: Partial<Record<AgentRole, number>> = {};
  for (const entry of experts.roster) {
    if (entry.tokens_used !== null) tokens[entry.role] = entry.tokens_used;
  }
  return { notes: [...byRole.values()], tokens };
}

/** Write the chief architect's synthesis section (`experts synthesis`). */
export function writeExpertSynthesis(
  projectRoot: string,
  dirName: string,
  synthesis: ExpertSynthesis,
  options: StoreWriteOptions = {},
): void {
  writeExperts(projectRoot, dirName, { synthesis }, options);
}

/** The recorded synthesis, or null when the chief never ran. */
export function readExpertSynthesis(projectRoot: string, dirName: string): ExpertSynthesis | null {
  return readExperts(projectRoot, dirName)?.synthesis ?? null;
}

/** Clear the synthesis section (a redo of the experts step). */
export function clearExpertSynthesis(
  projectRoot: string,
  dirName: string,
  options: StoreWriteOptions = {},
): void {
  writeExperts(projectRoot, dirName, { synthesis: null }, options);
}

// ── Grounding ───────────────────────────────────────────────────────────────────────────

/**
 * The run's grounding: the staged copy before freeze, else the `grounding` section a frozen
 * `specification.json` carries (which has no terms). Null when neither exists.
 */
export function readGrounding(projectRoot: string, dirName: string): GroundingArtifact | null {
  const staged = readStagedJson<GroundingArtifact>(projectRoot, dirName, 'grounding');
  if (staged) return staged;
  const frozen = readBundleBody(projectRoot, dirName, 'specification')?.grounding;
  if (!isRecord(frozen) || !Array.isArray(frozen.references)) return null;
  return { terms: [], ...(frozen as unknown as Omit<GroundingArtifact, 'terms'>) };
}

/** The frozen `specification.json` body (header stripped), or null before freeze. */
export function readFrozenSpecificationBody(
  projectRoot: string,
  dirName: string,
): Record<string, unknown> | null {
  return readBundleBody(projectRoot, dirName, 'specification');
}

// ── Freeze ──────────────────────────────────────────────────────────────────────────────

/** The staged run, shaped as the sections `spec freeze --from-pipeline` merges (issue #581). */
export interface FreezeSections {
  task?: SpecTaskSection;
  grounding?: SpecGroundingSection;
  pipeline: SpecPipelineSection;
  trace?: SpecTraceMap;
}

/**
 * Shape the staged run into the `specification.json` sections (FR-3): `task` (intent, scope),
 * `grounding` without its terms, `pipeline` from the finish result, and the `trace` map keyed by
 * requirement id. Null when `finish` has not run, so freeze can refuse an unfinished run.
 */
export function readFreezeSections(projectRoot: string, dirName: string): FreezeSections | null {
  const finish = readStagedJson<StagedFinish>(projectRoot, dirName, 'finish');
  if (!isRecord(finish) || !isRecord(finish.provenance)) return null;
  const task = readStagedJson<Record<string, unknown>>(projectRoot, dirName, 'task');
  const grounding = readStagedJson<GroundingArtifact>(projectRoot, dirName, 'grounding');
  const trace = readStagedJson<{ entries?: unknown }>(projectRoot, dirName, 'trace');
  return {
    ...(isRecord(task) && typeof task.intent === 'string'
      ? { task: { intent: task.intent, scope: isRecord(task.scope) ? task.scope : {} } }
      : {}),
    ...(isRecord(grounding)
      ? {
          grounding: {
            path: grounding.path,
            sparse: grounding.sparse,
            references: grounding.references,
          },
        }
      : {}),
    pipeline: frozenPipelineSection(finish),
    ...(isRecord(trace) && Array.isArray(trace.entries)
      ? {
          trace: Object.fromEntries(
            (trace.entries as { id: string; source: string }[]).map((entry) => [
              entry.id,
              entry.source,
            ]),
          ),
        }
      : {}),
  };
}

/** True for a project-relative path that stays inside `.paqad/tmp/`. */
function isTmpPath(rel: string): boolean {
  return rel.startsWith('.paqad/tmp/') && !rel.split('/').includes('..');
}

/**
 * Delete what the pipeline and freeze left in `.paqad/tmp/` for this change once the spec is
 * frozen (FR-4, AC-3): every remembered input except the ones in `keep`, then the staging dir.
 * The shared staging root goes too when this was the last change in it. Best-effort.
 */
export function clearFrozenRun(
  projectRoot: string,
  dirName: string,
  keep: readonly string[] = [],
): void {
  for (const rel of readRememberedInputs(projectRoot, dirName)) {
    if (isTmpPath(rel) && !keep.includes(rel)) rmSync(join(projectRoot, rel), { force: true });
  }
  rmSync(join(projectRoot, stagingDir(dirName)), { recursive: true, force: true });
  try {
    rmdirSync(join(projectRoot, SPEC_PIPELINE_STAGING_DIR));
  } catch {
    // Another change is still staged there, or it never existed.
  }
}

// ── Remembered inputs ───────────────────────────────────────────────────────────────────

/** Both spellings of the project root (as given, and with symlinks resolved). */
function rootForms(projectRoot: string): string[] {
  const given = resolve(projectRoot);
  let real = given;
  try {
    real = resolve(realpathSync(projectRoot));
  } catch {
    // An unresolvable root has only the spelling it was given.
  }
  return [...new Set([given, real])];
}

/** The project-relative path of `file` when it sits under `.paqad/tmp/`, else null. */
function tmpInputPath(projectRoot: string, file: string): string | null {
  const abs = resolve(file);
  for (const base of rootForms(projectRoot)) {
    const rel = relative(base, abs);
    if (rel.startsWith('.paqad/tmp/')) return rel;
  }
  return null;
}

/**
 * Remember an input path a record verb was handed, when it sits under `.paqad/tmp/`, so
 * `spec freeze` can delete exactly the inputs this change created (FR-4). Paths elsewhere are
 * the user's own files and are never recorded.
 */
export function rememberInput(projectRoot: string, dirName: string, file: string): void {
  const rel = tmpInputPath(projectRoot, file);
  if (rel === null) return;
  const inputs = readRememberedInputs(projectRoot, dirName);
  if (inputs.includes(rel)) return;
  writeStagedJson(projectRoot, dirName, 'inputs', { inputs: [...inputs, rel] });
}

/** The project-relative `.paqad/tmp/` inputs remembered for this change. */
export function readRememberedInputs(projectRoot: string, dirName: string): string[] {
  return readStagedJson<{ inputs: string[] }>(projectRoot, dirName, 'inputs')?.inputs ?? [];
}

// ── stage-evidence rows ─────────────────────────────────────────────────────────────────

export interface SpecStepRowInput {
  step: PipelineStep;
  outcome: SpecStepOutcome;
  artifactHash: string;
  /** Tokens the agent reported for the step, when it reported a whole, non-negative number. */
  tokens?: number;
}

/** Append one `kind: 'spec-step'` row to the bundle's stage evidence (FR-7). */
export function appendSpecStepRow(
  projectRoot: string,
  dirName: string,
  input: SpecStepRowInput,
  options: StoreWriteOptions = {},
): SessionLedgerRow {
  return appendFeatureStageRow(
    projectRoot,
    documentSessionId(projectRoot, dirName, options.sessionId),
    dirName,
    {
      kind: SPEC_STEP_KIND,
      step: input.step,
      outcome: input.outcome,
      artifact_hash: input.artifactHash,
      ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
    },
    options.now,
  );
}

/** The change's `spec-step` rows, in the order they were written. */
export function readSpecStepRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readFeatureStageUnit(projectRoot, dirName).filter((row) => row.kind === SPEC_STEP_KIND);
}

/** Append one `kind: 'spec-correction'` row: a later edit to a frozen spec (FR-7). */
export function appendSpecCorrectionRow(
  projectRoot: string,
  dirName: string,
  correction: { spec_id: string; changed_sections: string[] },
  options: StoreWriteOptions = {},
): SessionLedgerRow {
  return appendFeatureStageRow(
    projectRoot,
    documentSessionId(projectRoot, dirName, options.sessionId),
    dirName,
    {
      kind: SPEC_CORRECTION_KIND,
      spec_id: correction.spec_id,
      changed_sections: correction.changed_sections,
    },
    options.now,
  );
}

/** The change's `spec-correction` rows, in the order they were written. */
export function readSpecCorrectionRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readFeatureStageUnit(projectRoot, dirName).filter(
    (row) => row.kind === SPEC_CORRECTION_KIND,
  );
}
