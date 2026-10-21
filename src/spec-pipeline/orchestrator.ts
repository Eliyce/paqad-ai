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

export const PIPELINE_ARTIFACT_FILES: Record<PipelineStep, string> = {
  ground: 'grounding.json',
  label: 'clarification.json',
  experts: 'experts.json',
  questions: 'clarification.json',
  task: 'task.json',
  craft: 'spec.md',
  finish: 'finish.json',
};

const STAGED_STEPS: Partial<Record<PipelineStep, StagedFile>> = {
  ground: 'grounding',
  task: 'task',
  craft: 'craft',
  finish: 'finish',
};

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
    /* v8 ignore start -- exhaustive; craft handled above */
    default:
      return { ok: true };
    /* v8 ignore stop */
  }
}
export function stepArtifactValid(
  projectRoot: string,
  dirName: string,
  step: PipelineStep,
): boolean {
  return validateStepArtifact(step, readStepArtifact(projectRoot, dirName, step)).ok;
}

export function labelIsClear(projectRoot: string, dirName: string): boolean {
  return readLabel(projectRoot, dirName)?.label === 'clear';
}

export function readQuestionsArtifact(
  projectRoot: string,
  dirName: string,
): QuestionsArtifact | null {
  return readQuestions(projectRoot, dirName);
}

export function hasExpertOrChiefQuestions(projectRoot: string, dirName: string): boolean {
  if (readStagedExpertQuestions(projectRoot, dirName).some((note) => note.questions.length > 0)) {
    return true;
  }
  const synthesis = readExpertSynthesis(projectRoot, dirName);
  if (synthesis === null) return false;
  return synthesis.questions.length > 0 || synthesis.gaps.some((gap) => gap.question !== undefined);
}

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
  missing?: PipelineStep;
  message?: string;
}

export interface AssertStepOptions {
  hasPendingExpertConflict?: boolean;
}

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
  tokens?: unknown;
}

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
