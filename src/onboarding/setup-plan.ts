import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FrameworkError } from '@/core/errors/index.js';
import { toPosixPath } from '@/core/path-utils.js';

/**
 * The setup-plan record (Slice 3, FR-5/FR-6, AC-6).
 *
 * This is the paqad answer to BND-04: paqad ships NO installers. A created-but-undecided
 * workspace still needs its application stack installed, and that is done by the official
 * installers, CLIs and connected tools the owner/host runs — never by paqad. So instead of
 * executing anything, paqad RECORDS the dependency-ordered steps (the official command to run,
 * how to verify it, how to recover) and TRACKS each step's state. The record is advice plus a
 * progress ledger, nothing more.
 */

/** Where the record lives — alongside the profile, NOT inside any feature-evidence bundle dir. */
export const SETUP_PLAN_FILE = '.paqad/setup-plan.json';

/** The schema version this module reads and writes. A string so the JSON is stable. */
export const SETUP_PLAN_SCHEMA_VERSION = '1' as const;

/** The lifecycle state of a single setup step (FR-6). */
export type SetupStepState = 'pending' | 'in_progress' | 'blocked' | 'completed';

const SETUP_STEP_STATES: readonly SetupStepState[] = [
  'pending',
  'in_progress',
  'blocked',
  'completed',
];

/** A step as authored/derived, before it is placed in a plan (no state yet). */
export interface SetupStepInput {
  /** Stable, unique id (a later step's `prerequisite` references it). */
  id: string;
  /** Human-readable description of what this step accomplishes. */
  description: string;
  /** The official command or tool the owner/host runs — paqad never executes it (BND-04). */
  command: string;
  /** How to confirm the step succeeded. */
  verify: string;
  /** What to do when the step fails or the tool is missing (FR-6 blocker recovery). */
  recovery: string;
  /** Optional pinned version. */
  version?: string;
  /** Optional id of an EARLIER step that must complete first (dependency order). */
  prerequisite?: string;
}

/** A step inside a plan: an input plus its tracked lifecycle state. */
export interface SetupStep extends SetupStepInput {
  state: SetupStepState;
}

/**
 * The dependency-ordered setup-plan record. `slice` names the scope (e.g. `"#596 slice 3"`) so
 * the record can never imply the parent issue is complete (INV-2): it carries no "parent done"
 * field, only the slice it belongs to.
 */
export interface SetupPlan {
  schema_version: typeof SETUP_PLAN_SCHEMA_VERSION;
  project_root: string;
  slice: string;
  created_at: string;
  steps: SetupStep[];
}

export interface BuildSetupPlanInput {
  projectRoot: string;
  /** The scope this plan belongs to — never the parent issue (INV-2). */
  slice: string;
  /** Steps in dependency order; order is preserved verbatim. */
  steps: SetupStepInput[];
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Build a setup-plan record from dependency-ordered steps (FR-5, AC-6). Every step starts
 * `pending`, input order is preserved (it IS the dependency order), and `created_at` is stamped.
 * This is pure and deterministic — zero model tokens.
 */
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

/**
 * Validate a setup-plan record (AC-6). Deterministic, zero model tokens, one actionable line per
 * problem. Rejects: a non-object; an empty/missing `steps`; a step missing a non-empty
 * `id`/`description`/`command`/`verify`/`recovery`; a duplicate step id; a `prerequisite` that does
 * not reference an EARLIER step (a forward or unknown reference); an invalid `state`.
 */
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

    // Record the id AFTER its own prerequisite is checked, so a step can never list itself as a
    // prerequisite and a forward reference to a later step is caught as unknown.
    if (typeof id === 'string' && id.trim().length > 0) {
      seenIds.add(id);
    }
  });

  return { ok: errors.length === 0, errors };
}

function setupPlanPath(projectRoot: string): string {
  return join(projectRoot, '.paqad', 'setup-plan.json');
}

/** Persist a setup-plan record to `.paqad/setup-plan.json` atomically (temp + rename). */
export function writeSetupPlan(projectRoot: string, plan: SetupPlan): string {
  const absPath = setupPlanPath(projectRoot);
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
  return absPath;
}

/** Read the setup-plan record, or `null` when none exists or it is unreadable. */
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

/**
 * Advance a single step's state and persist the record (FR-6 step tracking). Throws a clear
 * error when the step id is unknown, so a typo can never silently no-op.
 */
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
