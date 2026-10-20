import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FrameworkError } from '@/core/errors/index.js';
import { toPosixPath } from '@/core/path-utils.js';

export const SETUP_PLAN_FILE = '.paqad/setup-plan.json';

export const SETUP_PLAN_SCHEMA_VERSION = '1' as const;

export type SetupStepState = 'pending' | 'in_progress' | 'blocked' | 'completed';

const SETUP_STEP_STATES: readonly SetupStepState[] = [
  'pending',
  'in_progress',
  'blocked',
  'completed',
];

export interface SetupStepInput {
  id: string;
  description: string;
  command: string;
  verify: string;
  recovery: string;
  version?: string;
  prerequisite?: string;
}

export interface SetupStep extends SetupStepInput {
  state: SetupStepState;
}

export interface SetupPlan {
  schema_version: typeof SETUP_PLAN_SCHEMA_VERSION;
  project_root: string;
  slice: string;
  created_at: string;
  steps: SetupStep[];
}

export interface BuildSetupPlanInput {
  projectRoot: string;
  slice: string;
  steps: SetupStepInput[];
  now?: () => Date;
}

export function buildSetupPlan(input: BuildSetupPlanInput): SetupPlan {
  const now = input.now ?? (() => new Date());
  return {
    schema_version: SETUP_PLAN_SCHEMA_VERSION,
    project_root: toPosixPath(input.projectRoot),
    slice: input.slice,
    created_at: now().toISOString(),
    steps: input.steps.map((step) => ({ ...step, state: 'pending' as const })),
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSetupPlan(plan: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
    return { ok: false, errors: ['setup plan must be a JSON object'] };
  }

  const steps = (plan as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, errors: ['setup plan must have a non-empty "steps" array'] };
  }

  const seenIds = new Set<string>();

  steps.forEach((raw, index) => {
    const label = `step ${index + 1}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(`${label}: must be an object`);
      return;
    }
    const step = raw as Record<string, unknown>;

    for (const field of ['id', 'description', 'command', 'verify', 'recovery'] as const) {
      const value = step[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(`${label}: "${field}" must be a non-empty string`);
      }
    }

    const id = step.id;
    if (typeof id === 'string' && id.trim().length > 0) {
      if (seenIds.has(id)) {
        errors.push(`${label}: duplicate step id "${id}"`);
      }
    }

    const prerequisite = step.prerequisite;
    if (prerequisite !== undefined) {
      if (typeof prerequisite !== 'string' || !seenIds.has(prerequisite)) {
        errors.push(
          `${label}: prerequisite "${String(prerequisite)}" must reference an earlier step's id`,
        );
      }
    }

    const state = step.state;
    if (!SETUP_STEP_STATES.includes(state as SetupStepState)) {
      errors.push(
        `${label}: "state" must be one of ${SETUP_STEP_STATES.join(', ')} (got "${String(state)}")`,
      );
    }

    if (typeof id === 'string' && id.trim().length > 0) {
      seenIds.add(id);
    }
  });

  return { ok: errors.length === 0, errors };
}

function setupPlanPath(projectRoot: string): string {
  return join(projectRoot, '.paqad', 'setup-plan.json');
}

export function writeSetupPlan(projectRoot: string, plan: SetupPlan): string {
  const absPath = setupPlanPath(projectRoot);
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
  return absPath;
}

export function readSetupPlan(projectRoot: string): SetupPlan | null {
  const absPath = setupPlanPath(projectRoot);
  if (!existsSync(absPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(absPath, 'utf8')) as SetupPlan;
  } catch {
    return null;
  }
}

export function advanceSetupStep(
  projectRoot: string,
  stepId: string,
  state: SetupStepState,
): SetupPlan {
  const plan = readSetupPlan(projectRoot);
  if (!plan) {
    throw new FrameworkError(`No setup plan found at ${toPosixPath(SETUP_PLAN_FILE)}.`, {
      code: 'SETUP_PLAN_NOT_FOUND',
      details: { projectRoot: toPosixPath(projectRoot) },
    });
  }

  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    const known = plan.steps.map((candidate) => candidate.id).join(', ');
    throw new FrameworkError(
      `Unknown setup step "${stepId}" — known step ids: ${known || '(none)'}.`,
      { code: 'SETUP_STEP_UNKNOWN', details: { stepId } },
    );
  }

  step.state = state;
  writeSetupPlan(projectRoot, plan);
  return plan;
}
