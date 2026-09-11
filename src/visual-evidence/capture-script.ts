// Capture-script loader (issue #551, Part C).
//
// A capture script (`docs/site-map/journeys/<id>.capture.yaml`) is the documented-flow →
// executable bridge. It is authored at agent time (site-map / documentation workflow) — this
// module only LOADS and validates them: schema shape plus the cross-checks that a runtime
// script cannot express (the referenced journey exists and is `confirmed`, every `journey_step`
// is real, steps are ordered). A script pointing at a `proposed` journey is invalid and is
// reported, never silently used.

import { existsSync, readdirSync } from 'node:fs';

import { join } from 'pathe';

import type { Journey } from '@/core/types/site-map.js';
import { validateJourneyCapture } from '@/site-map/schema.js';
import { journeysDir, readJourney, readYaml } from '@/site-map/store.js';

/** The `do` verbs a capture action may perform. */
export type CaptureVerb = 'click' | 'fill' | 'select' | 'press' | 'wait_for';

export interface CaptureAction {
  selector: string;
  do: CaptureVerb;
  value?: string;
}

export interface CaptureSetupStep {
  goto?: string;
  actions?: CaptureAction[];
}

export interface CaptureStep {
  journey_step: number;
  goto?: string;
  actions?: CaptureAction[];
  /** Defaults to true; false = an interaction-only step that captures no screenshot. */
  screenshot?: boolean;
}

export interface CaptureScript {
  schema_version: 1;
  journey: string;
  setup?: CaptureSetupStep[];
  steps: CaptureStep[];
}

/** A capture script that passed schema + cross-checks, paired with its confirmed journey. */
export interface LoadedCaptureScript {
  /** Project-relative posix path to the capture file. */
  file: string;
  script: CaptureScript;
  journey: Journey;
}

/** A capture file that failed to load, with its human-readable problems. */
export interface CaptureScriptError {
  file: string;
  errors: string[];
}

export interface CaptureScriptsResult {
  scripts: LoadedCaptureScript[];
  errors: CaptureScriptError[];
}

const CAPTURE_SUFFIX = '.capture.yaml';

/** True when the value is present (a `$VE_*` reference counts as present; it resolves at runtime). */
function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

/** Validate one action's value-requiredness by its verb. Returns problems (empty ⇒ ok). */
function actionProblems(action: CaptureAction, where: string): string[] {
  const problems: string[] = [];
  const { do: verb, value } = action;
  if ((verb === 'fill' || verb === 'select' || verb === 'press') && !hasValue(value)) {
    problems.push(`${where}: \`${verb}\` requires a value`);
  }
  if (verb === 'wait_for' && value !== 'visible' && value !== 'hidden') {
    problems.push(`${where}: \`wait_for\` requires a value of "visible" or "hidden"`);
  }
  return problems;
}

/** Cross-check a schema-valid script against its journey. Returns problems (empty ⇒ ok). */
function crossCheck(script: CaptureScript, basename: string, journey: Journey | null): string[] {
  const problems: string[] = [];

  if (basename !== script.journey) {
    problems.push(
      `journey "${script.journey}" must equal the sibling file id "${basename}" (${basename}${CAPTURE_SUFFIX})`,
    );
  }

  if (!journey) {
    problems.push(`journey "${script.journey}" does not resolve to an existing journey`);
    return problems;
  }
  if (journey.status !== 'confirmed') {
    problems.push(
      `journey "${script.journey}" is ${journey.status}, not confirmed — only confirmed journeys produce evidence`,
    );
  }

  const stepCount = journey.steps.length;
  let previous = 0;
  for (const step of script.steps) {
    if (step.journey_step < 1 || step.journey_step > stepCount) {
      problems.push(
        `journey_step ${step.journey_step} does not exist in journey "${script.journey}" (${stepCount} steps)`,
      );
    }
    if (step.journey_step < previous) {
      problems.push(
        `steps must be ordered ascending by journey_step (saw ${step.journey_step} after ${previous})`,
      );
    }
    previous = step.journey_step;
    for (const [i, action] of (step.actions ?? []).entries()) {
      problems.push(...actionProblems(action, `step ${step.journey_step} action ${i + 1}`));
    }
  }

  for (const [i, setup] of (script.setup ?? []).entries()) {
    for (const [j, action] of (setup.actions ?? []).entries()) {
      problems.push(...actionProblems(action, `setup ${i + 1} action ${j + 1}`));
    }
  }

  return problems;
}

/** List the capture-script basenames (without suffix) present under the journeys dir. */
export function listCaptureScriptIds(projectRoot: string): string[] {
  const dir = journeysDir(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(CAPTURE_SUFFIX))
    .map((name) => name.slice(0, -CAPTURE_SUFFIX.length))
    .sort();
}

/**
 * Load and validate every capture script under `docs/site-map/journeys/`. Returns the scripts
 * that passed schema + cross-checks (paired with their confirmed journey), and a per-file list
 * of problems for those that did not.
 */
export function loadCaptureScripts(projectRoot: string): CaptureScriptsResult {
  const scripts: LoadedCaptureScript[] = [];
  const errors: CaptureScriptError[] = [];
  const dir = journeysDir(projectRoot);

  for (const basename of listCaptureScriptIds(projectRoot)) {
    const file = `docs/site-map/journeys/${basename}${CAPTURE_SUFFIX}`;
    const parsed = readYaml(join(dir, `${basename}${CAPTURE_SUFFIX}`));
    if (parsed === null) {
      errors.push({ file, errors: ['file is missing or not valid YAML'] });
      continue;
    }
    const shape = validateJourneyCapture(parsed);
    if (!shape.valid) {
      errors.push({ file, errors: shape.errors });
      continue;
    }
    const script = parsed as CaptureScript;
    const journey = readJourney(projectRoot, script.journey);
    const problems = crossCheck(script, basename, journey);
    if (problems.length > 0) {
      errors.push({ file, errors: problems });
      continue;
    }
    // journey is non-null here (crossCheck would have reported otherwise).
    scripts.push({ file, script, journey: journey as Journey });
  }

  return { scripts, errors };
}

/**
 * Derive the business-language caption for a step: the journey step's `action` text, with
 * `". "` + `expect` appended when the step declares an expectation. Deterministic, model-free.
 */
export function deriveCaption(journey: Journey, journeyStep: number): string {
  const step = journey.steps[journeyStep - 1];
  const action = step?.action ?? '';
  const expect = step?.expect;
  return expect ? `${action}. ${expect}` : action;
}
