// The workflow-preflight runner (issue: site-map rebuild S3a, fixing D5/D6).
//
// Runs each of a workflow's requirement probes and turns the unmet ones into a single batched
// question set, so a workflow can ask everything it needs in one interruption before it starts.
// Generic: it reads the requirement list from the registry and never mentions any specific
// workflow.

import type {
  PreflightQuestion,
  PreflightRequirement,
  PreflightRequirementResult,
  PreflightResult,
} from './contract.js';
import { requirementsFor } from './registry.js';

/**
 * Probe every requirement and return the results in declaration order. Exposed so tests can drive
 * the runner with a fixed requirement list without going through the registry.
 */
export async function evaluateRequirements(
  requirements: PreflightRequirement[],
  projectRoot: string,
): Promise<PreflightRequirementResult[]> {
  // Sequential so the results are in declaration order deterministically, and so probes that shell
  // out do not run all at once. There are only a handful of requirements per workflow.
  const results: PreflightRequirementResult[] = [];
  for (const requirement of requirements) {
    const outcome = await requirement.probe(projectRoot);
    results.push({
      id: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
      why: requirement.why,
      outcome,
      options: requirement.options,
    });
  }
  return results;
}

/** A requirement result the person still has to answer (unavailable or needs-decision). */
function toQuestion(result: PreflightRequirementResult): PreflightQuestion {
  return {
    id: result.id,
    label: result.label,
    why: result.why,
    // Narrowed by the caller's filter: only non-ok results reach here.
    outcome: result.outcome as Exclude<typeof result.outcome, 'ok'>,
    options: result.options,
  };
}

/**
 * Run preflight for a workflow: probe its registered requirements, collect every one that is not
 * `ok` into `questions` (in declaration order), and report `ok` only when nothing is left to ask.
 * A workflow with no requirements returns `ok: true` and no questions.
 */
export async function runPreflight(
  projectRoot: string,
  workflow: string,
): Promise<PreflightResult> {
  const requirements = await evaluateRequirements(requirementsFor(workflow), projectRoot);
  const questions = requirements.filter((result) => result.outcome !== 'ok').map(toQuestion);
  return { ok: questions.length === 0, requirements, questions };
}
