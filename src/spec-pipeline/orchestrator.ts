// The spec-pipeline orchestrator — the deterministic step machine (issue #512, FR-1).
//
// The SCRIPT owns sequencing and every gate; the model never decides what runs next. Each
// step writes one artifact under the git-ignored scratch dir; the next step is LOCKED until
// its predecessor's artifact exists and validates (FR-1.2). Re-running continues from the
// first incomplete step (FR-1.3, resume). Every completion is logged with the artifact hash,
// outcome, and the enforcement config in effect (FR-1.5). Durable outputs (the frozen spec,
// trace.json) are written ONLY by the sanctioned writers — this module writes scratch only
// under `.paqad/_specs/<feature>/pipeline/`, never into the bundle (INV-6).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { checkSpecShape } from './parser-parity.js';
import { readPipelineConfig, type PipelineConfig } from './config.js';
import {
  PIPELINE_STEPS,
  type AutoAnswer,
  type PipelineStep,
  type QuestionsArtifact,
} from './types.js';

/** The scratch filename each step writes (craft writes the working `spec.md`). */
export const PIPELINE_ARTIFACT_FILES: Record<PipelineStep, string> = {
  ground: 'grounding.json',
  label: 'label.json',
  questions: 'questions.json',
  task: 'task.json',
  craft: 'spec.md',
  finish: 'finish.json',
};

/** Project-relative scratch dir for a feature's pipeline run (git-ignored, `_specs/`). */
export function pipelineScratchDir(dirName: string): string {
  return join('.paqad', '_specs', dirName, 'pipeline');
}

/** Project-relative path to a step's scratch artifact. */
export function pipelineArtifactPath(dirName: string, step: PipelineStep): string {
  return join(pipelineScratchDir(dirName), PIPELINE_ARTIFACT_FILES[step]);
}

/** Project-relative path to the per-run completion log (FR-1.5). */
export function pipelineLogPath(dirName: string): string {
  return join(pipelineScratchDir(dirName), 'log.jsonl');
}

function readFileSafe(abs: string): string | null {
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
        return { ok: false, error: 'label.json needs label, signals[], question_budget' };
      }
      return { ok: true };
    case 'questions': {
      // `questions[]` is the only hard requirement (INV-3): a raw agent batch validates. The
      // enriched fields the record command adds — `auto_answered[]` and the FR-7.6 counts — are
      // validated only when present, so both the raw and the enriched artifact pass.
      if (!Array.isArray(obj.questions)) {
        return { ok: false, error: 'questions.json needs a questions[] array' };
      }
      if (obj.auto_answered !== undefined && !Array.isArray(obj.auto_answered)) {
        return { ok: false, error: 'questions.json auto_answered must be an array' };
      }
      for (const count of ['asked', 'answered', 'deferred'] as const) {
        if (obj[count] !== undefined && typeof obj[count] !== 'number') {
          return { ok: false, error: `questions.json ${count} must be a number` };
        }
      }
      return { ok: true };
    }
    case 'task':
      if (typeof obj.intent !== 'string' || obj.intent.length === 0) {
        return { ok: false, error: 'task.json needs a non-empty intent' };
      }
      return { ok: true };
    case 'finish':
      if (typeof obj.outcome !== 'string') {
        return { ok: false, error: 'finish.json needs an outcome' };
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
  const raw = readFileSafe(join(projectRoot, pipelineArtifactPath(dirName, step)));
  return validateStepArtifact(step, raw).ok;
}

/** True when the label recorded for this run is `clear` (⇒ the question round is skipped). */
export function labelIsClear(projectRoot: string, dirName: string): boolean {
  const raw = readFileSafe(join(projectRoot, pipelineArtifactPath(dirName, 'label')));
  const data = raw === null ? undefined : parseJson(raw);
  return (
    typeof data === 'object' && data !== null && (data as Record<string, unknown>).label === 'clear'
  );
}

/**
 * Read the recorded `questions.json` (issue #517). Returns null when the step never ran (the
 * label was `clear`, so no questions were produced). Missing enriched fields default to empty
 * so a pre-#517 artifact still reads cleanly.
 */
export function readQuestionsArtifact(
  projectRoot: string,
  dirName: string,
): QuestionsArtifact | null {
  const raw = readFileSafe(join(projectRoot, pipelineArtifactPath(dirName, 'questions')));
  const data = raw === null ? undefined : parseJson(raw);
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const obj = data as Record<string, unknown>;
  const autoAnswered = Array.isArray(obj.auto_answered) ? (obj.auto_answered as AutoAnswer[]) : [];
  const asNumber = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    questions: Array.isArray(obj.questions)
      ? (obj.questions as QuestionsArtifact['questions'])
      : [],
    auto_answered: autoAnswered,
    asked: asNumber(obj.asked),
    answered: asNumber(obj.answered),
    deferred: asNumber(obj.deferred),
  };
}

/**
 * Whether a step counts as complete for sequencing. `questions` is complete-by-skip when the
 * label is `clear` (FR-3.4 / FR-8.4 — an empty step is skipped, never run "to be safe").
 */
export function stepComplete(projectRoot: string, dirName: string, step: PipelineStep): boolean {
  if (step === 'questions' && labelIsClear(projectRoot, dirName)) {
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

/** Assert a step may run: every earlier step must be complete (FR-1.2 / AC-10). */
export function assertCanRunStep(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
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
  return { allowed: true };
}

function atomicWrite(abs: string, text: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, abs);
}

/** Write a step's scratch artifact (only ever under the pipeline scratch dir). */
export function writeStepArtifact(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
  content: string,
): void {
  atomicWrite(join(projectRoot, pipelineArtifactPath(dirName, step)), content);
}

export interface PipelineLogRow {
  ts: string;
  step: PipelineStep;
  outcome: 'complete' | 'skipped';
  hash: string;
  enforcement: PipelineConfig;
}

/** Append a completion row to the run log (FR-1.5). `now` is injectable for determinism. */
export function recordStep(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
  outcome: 'complete' | 'skipped',
  now: () => Date = () => new Date(),
  env: NodeJS.ProcessEnv = process.env,
): PipelineLogRow {
  const raw = readFileSafe(join(projectRoot, pipelineArtifactPath(dirName, step)));
  const hash = raw === null ? '' : createHash('sha256').update(raw).digest('hex');
  const row: PipelineLogRow = {
    ts: now().toISOString(),
    step,
    outcome,
    hash,
    enforcement: readPipelineConfig(projectRoot, env),
  };
  const abs = join(projectRoot, pipelineLogPath(dirName));
  mkdirSync(dirname(abs), { recursive: true });
  const existing = readFileSafe(abs) ?? '';
  writeFileSync(abs, `${existing}${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

/** Read the run log rows (empty when no run has started). */
export function readPipelineLog(projectRoot: string, dirName: string): PipelineLogRow[] {
  const raw = readFileSafe(join(projectRoot, pipelineLogPath(dirName)));
  if (raw === null) return [];
  const rows: PipelineLogRow[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const parsed = parseJson(line);
    if (parsed !== undefined) rows.push(parsed as PipelineLogRow);
  }
  return rows;
}

/**
 * Redo a step (FR-1.3): archive its artifact and every downstream artifact so the run
 * re-derives them. Returns the steps that were invalidated. Never touches the bundle.
 */
export function redoStep(projectRoot: string, dirName: string, step: PipelineStep): PipelineStep[] {
  const startIndex = PIPELINE_STEPS.indexOf(step);
  const invalidated: PipelineStep[] = [];
  const stamp = Date.now();
  for (let i = startIndex; i < PIPELINE_STEPS.length; i += 1) {
    const s = PIPELINE_STEPS[i]!;
    const abs = join(projectRoot, pipelineArtifactPath(dirName, s));
    if (existsSync(abs)) {
      renameSync(abs, `${abs}.redo-${stamp}`);
      invalidated.push(s);
    }
  }
  return invalidated;
}
