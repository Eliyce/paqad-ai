// The spec-pipeline orchestrator — the deterministic step machine (issue #512, FR-1).
//
// The SCRIPT owns sequencing and every gate; the model never decides what runs next. Each
// step records one artifact; the next step is LOCKED until its predecessor's artifact exists
// and validates (FR-1.2). Re-running continues from the first incomplete step (FR-1.3, resume).
// Every completion appends one `kind: 'spec-step'` row to the bundle's stage evidence with the
// artifact hash and outcome (FR-1.5). Where each step's artifact lives is the run store's
// business (issue #581): the label, question batch and expert synthesis are sections of
// bundle documents, the rest stage under `.paqad/tmp/spec-pipeline/<ULID>/` until freeze.
// This module reads and writes only through that store.

import { sha256Hex } from '@/compliance/markdown.js';

import { checkSpecShape } from './parser-parity.js';
import { expertsActive, readPipelineConfig } from './config.js';
import {
  appendSpecStepRow,
  clearClarificationSection,
  clearExpertSynthesis,
  clearStaged,
  readExperts,
  readExpertSynthesis,
  readLabel,
  readQuestions,
  readStagedExpertQuestions,
  readStagedText,
  writeExpertSynthesis,
  writeLabel,
  writeQuestions,
  writeStagedText,
  type StagedFile,
  type StoreWriteOptions,
} from './run-store.js';
import type { ExpertSynthesis } from './experts/synthesis.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import type { SpecStepOutcome } from '@/stage-evidence/types.js';
import {
  PIPELINE_STEPS,
  type LabelArtifact,
  type PipelineStep,
  type QuestionsArtifact,
} from './types.js';

/** The file each step's artifact is recorded in (named in step-lock messages). */
export const PIPELINE_ARTIFACT_FILES: Record<PipelineStep, string> = {
  ground: 'grounding.json',
  label: 'clarification.json',
  experts: 'experts.json',
  questions: 'clarification.json',
  task: 'task.json',
  craft: 'spec.md',
  finish: 'finish.json',
};

/** The steps whose artifact stages until freeze, and the staged file each one uses. */
const STAGED_STEPS: Partial<Record<PipelineStep, StagedFile>> = {
  ground: 'grounding',
  task: 'task',
  craft: 'craft',
  finish: 'finish',
};

/**
 * A step's recorded artifact as text, or null when the step has not recorded one. A staged
 * step returns its staged file byte-for-byte; a bundle section (label, questions, experts)
 * returns that section in the step machine's shape as JSON, so one validator judges both.
 */
export function readStepArtifact(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
): string | null {
  const staged = STAGED_STEPS[step];
  if (staged) return readStagedText(projectRoot, dirName, staged);
  const section =
    step === 'label'
      ? readLabel(projectRoot, dirName)
      : step === 'questions'
        ? readQuestions(projectRoot, dirName)
        : readExpertSynthesis(projectRoot, dirName);
  return section === null ? null : JSON.stringify(section);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export interface StepValidation {
  ok: boolean;
  error?: string;
}

/** Validate a step artifact's shape (the step-lock check). Deterministic, model-free. */
export function validateStepArtifact(step: PipelineStep, raw: string | null): StepValidation {
  if (raw === null) {
    return { ok: false, error: `${PIPELINE_ARTIFACT_FILES[step]} is missing` };
  }
  if (step === 'craft') {
    const shape = checkSpecShape(raw);
    return shape.ok ? { ok: true } : { ok: false, error: shape.problems.join('; ') };
  }
  const data = parseJson(raw);
  if (data === undefined || typeof data !== 'object' || data === null) {
    return { ok: false, error: `${PIPELINE_ARTIFACT_FILES[step]} is not valid JSON` };
  }
  const obj = data as Record<string, unknown>;
  switch (step) {
    case 'ground':
      if (
        !Array.isArray(obj.references) ||
        !isStringArray(obj.terms) ||
        typeof obj.sparse !== 'boolean'
      ) {
        return { ok: false, error: 'grounding.json needs references[], terms[], sparse' };
      }
      return { ok: true };
    case 'label':
      if (
        (obj.label !== 'vague' && obj.label !== 'okay' && obj.label !== 'clear') ||
        !Array.isArray(obj.signals) ||
        typeof obj.question_budget !== 'number'
      ) {
        return { ok: false, error: 'the label needs label, signals[], question_budget' };
      }
      return { ok: true };
    case 'experts':
      // The step-lock is a light shape check (issue #547); the full FR-5.4 chief-architect
      // validation runs in the `experts synthesis` CLI verb before this artifact is written.
      if (
        typeof obj.verdict !== 'string' ||
        !Array.isArray(obj.accepted) ||
        !Array.isArray(obj.declined) ||
        !Array.isArray(obj.conflicts) ||
        !Array.isArray(obj.gaps)
      ) {
        return {
          ok: false,
          error: 'the expert synthesis needs verdict, accepted[], declined[], conflicts[], gaps[]',
        };
      }
      return { ok: true };
    case 'questions': {
      // `questions[]` is the only hard requirement (INV-3): a raw agent batch validates. The
      // enriched fields the record command adds — `auto_answered[]` and the FR-7.6 counts — are
      // validated only when present, so both the raw and the enriched artifact pass.
      if (!Array.isArray(obj.questions)) {
        return { ok: false, error: 'the question batch needs a questions[] array' };
      }
      if (obj.auto_answered !== undefined && !Array.isArray(obj.auto_answered)) {
        return { ok: false, error: 'the question batch auto_answered must be an array' };
      }
      for (const count of ['asked', 'answered', 'deferred'] as const) {
        if (obj[count] !== undefined && typeof obj[count] !== 'number') {
          return { ok: false, error: `the question batch ${count} must be a number` };
        }
      }
      return { ok: true };
    }
    case 'task':
      if (typeof obj.intent !== 'string' || obj.intent.length === 0) {
        return { ok: false, error: 'the task needs a non-empty intent' };
      }
      return { ok: true };
    case 'finish':
      if (typeof obj.outcome !== 'string') {
        return { ok: false, error: 'the finish result needs an outcome' };
      }
      return { ok: true };
    /* v8 ignore next 2 -- exhaustive; craft handled above */
    default:
      return { ok: true };
  }
}
/** Read whether a step's artifact exists and validates. */
export function stepArtifactValid(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
): boolean {
  return validateStepArtifact(step, readStepArtifact(projectRoot, dirName, step)).ok;
}

/** True when the label recorded for this run is `clear` (⇒ the question round is skipped). */
export function labelIsClear(projectRoot: string, dirName: string): boolean {
  return readLabel(projectRoot, dirName)?.label === 'clear';
}

/**
 * Read the recorded question batch (issue #517), or null when the step never ran (the label was
 * `clear`, so no questions were produced).
 */
export function readQuestionsArtifact(
  projectRoot: string,
  dirName: string,
): QuestionsArtifact | null {
  return readQuestions(projectRoot, dirName);
}

/**
 * Whether any expert or chief question is waiting to join the S2 batch (issue #547, FR-7.3). Reads
 * the staged note questions and the synthesis' `gaps[].question` + `questions[]` directly, so a
 * `clear`-labelled prompt that nonetheless drew expert questions still runs S2.
 */
export function hasExpertOrChiefQuestions(projectRoot: string, dirName: string): boolean {
  if (readStagedExpertQuestions(projectRoot, dirName).some((note) => note.questions.length > 0)) {
    return true;
  }
  const synthesis = readExpertSynthesis(projectRoot, dirName);
  if (synthesis === null) return false;
  return synthesis.questions.length > 0 || synthesis.gaps.some((gap) => gap.question !== undefined);
}

/**
 * Whether a step counts as complete for sequencing.
 *   - `experts` is complete-by-skip when the roster is off or the recorded roster names zero
 *     experts (issue #547, FR-2.2); otherwise it needs a valid synthesis.
 *   - `questions` is complete-by-skip when the label is `clear` AND no expert or chief question is
 *     pending (FR-7.3; the base rule is FR-3.4 — an empty step is skipped, never run "to be safe").
 */
export function stepComplete(projectRoot: string, dirName: string, step: PipelineStep): boolean {
  if (step === 'experts') {
    if (!expertsActive(readPipelineConfig(projectRoot))) return true;
    if (readExperts(projectRoot, dirName)?.roster.length === 0) return true;
    return stepArtifactValid(projectRoot, dirName, step);
  }
  if (
    step === 'questions' &&
    labelIsClear(projectRoot, dirName) &&
    !hasExpertOrChiefQuestions(projectRoot, dirName)
  ) {
    return true;
  }
  return stepArtifactValid(projectRoot, dirName, step);
}

/** The first incomplete step (resume point), or null when the run is finished (FR-1.3). */
export function nextStep(projectRoot: string, dirName: string): PipelineStep | null {
  for (const step of PIPELINE_STEPS) {
    if (!stepComplete(projectRoot, dirName, step)) {
      return step;
    }
  }
  return null;
}

export interface StepGate {
  allowed: boolean;
  /** When blocked, the predecessor step that must run first, and a message. */
  missing?: PipelineStep;
  message?: string;
}

export interface AssertStepOptions {
  /**
   * Whether an unresolved `spec.expert_conflict` decision packet is pending for this change
   * (issue #547, FR-6.4). The CLI reads the decision store and passes it; `questions` cannot run
   * while one is pending, so the human resolves the conflict before the batch is asked.
   */
  hasPendingExpertConflict?: boolean;
}

/** Assert a step may run: every earlier step must be complete (FR-1.2 / AC-10). */
export function assertCanRunStep(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
  options: AssertStepOptions = {},
): StepGate {
  for (const earlier of PIPELINE_STEPS) {
    if (earlier === step) break;
    if (!stepComplete(projectRoot, dirName, earlier)) {
      return {
        allowed: false,
        missing: earlier,
        message: `cannot run "${step}": earlier step "${earlier}" is not complete (${PIPELINE_ARTIFACT_FILES[earlier]} missing or invalid)`,
      };
    }
  }
  if (step === 'questions' && options.hasPendingExpertConflict) {
    return {
      allowed: false,
      missing: 'experts',
      message:
        'cannot run "questions": an expert conflict is still pending a decision — resolve it first (FR-6.4)',
    };
  }
  return { allowed: true };
}

/**
 * Record a step's artifact where the run store keeps it: a staged file for ground, task, craft
 * and finish, or a bundle section for label, questions and experts (whose `content` is JSON).
 */
export function writeStepArtifact(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
  content: string,
  options: StoreWriteOptions = {},
): void {
  const staged = STAGED_STEPS[step];
  if (staged) {
    writeStagedText(projectRoot, dirName, staged, content);
  } else if (step === 'label') {
    writeLabel(projectRoot, dirName, JSON.parse(content) as LabelArtifact, options);
  } else if (step === 'questions') {
    writeQuestions(projectRoot, dirName, JSON.parse(content) as QuestionsArtifact, options);
  } else {
    writeExpertSynthesis(projectRoot, dirName, JSON.parse(content) as ExpertSynthesis, options);
  }
}

/**
 * Remove a step's recorded artifact, returning what it held in the {@link readStepArtifact} form
 * (so a redone row hashes the same text a complete row did), or null when it held nothing.
 */
function clearStepArtifact(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
  options: StoreWriteOptions,
): string | null {
  const prior = readStepArtifact(projectRoot, dirName, step);
  if (prior === null) return null;
  const staged = STAGED_STEPS[step];
  if (staged) {
    clearStaged(projectRoot, dirName, staged);
  } else if (step === 'experts') {
    clearExpertSynthesis(projectRoot, dirName, options);
  } else {
    clearClarificationSection(projectRoot, dirName, step as 'label' | 'questions', options);
  }
  return prior;
}

export interface RecordStepOptions extends StoreWriteOptions {
  /** Tokens the agent reported for the step (kept only when a whole, non-negative number). */
  tokens?: unknown;
}

/**
 * Append the step's `spec-step` row (FR-1.5, issue #581 FR-7): the step, how it ended and the
 * sha256 of the artifact it recorded (empty when it recorded none). The enforcement config is
 * NOT on the row: it is stored once, with the frozen spec (AC-11).
 */
export function recordStep(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
  outcome: Exclude<SpecStepOutcome, 'redone'>,
  options: RecordStepOptions = {},
): SessionLedgerRow {
  const raw = readStepArtifact(projectRoot, dirName, step);
  const tokens =
    typeof options.tokens === 'number' && Number.isInteger(options.tokens) && options.tokens >= 0
      ? options.tokens
      : undefined;
  return appendSpecStepRow(
    projectRoot,
    dirName,
    { step, outcome, artifactHash: raw === null ? '' : sha256Hex(raw), tokens },
    options,
  );
}

/**
 * Redo a step (FR-1.3): clear its artifact and every downstream artifact so the run re-derives
 * them, and append one `redone` row per cleared step carrying the hash of what was cleared.
 * Nothing is archived beside the artifact. Returns the steps that were invalidated.
 */
export function redoStep(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
  options: StoreWriteOptions = {},
): PipelineStep[] {
  const invalidated: PipelineStep[] = [];
  for (const s of PIPELINE_STEPS.slice(PIPELINE_STEPS.indexOf(step))) {
    const prior = clearStepArtifact(projectRoot, dirName, s, options);
    if (prior === null) continue;
    invalidated.push(s);
    appendSpecStepRow(
      projectRoot,
      dirName,
      { step: s, outcome: 'redone', artifactHash: sha256Hex(prior) },
      options,
    );
  }
  return invalidated;
}
