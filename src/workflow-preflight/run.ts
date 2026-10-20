import type {
  PreflightQuestion,
  PreflightRequirement,
  PreflightRequirementResult,
  PreflightResult,
} from './contract.js';
import { requirementsFor } from './registry.js';

export async function evaluateRequirements(
  requirements: PreflightRequirement[],
  projectRoot: string,
): Promise<PreflightRequirementResult[]> {
  const results: PreflightRequirementResult[] = [];
  for (const requirement of requirements) {
    if (requirement.applies && !requirement.applies(projectRoot)) continue;
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

function toQuestion(result: PreflightRequirementResult): PreflightQuestion {
  return {
    id: result.id,
    label: result.label,
    why: result.why,
    outcome: result.outcome as Exclude<typeof result.outcome, 'ok'>,
    options: result.options,
  };
}

export async function runPreflight(
  projectRoot: string,
  workflow: string,
): Promise<PreflightResult> {
  const requirements = await evaluateRequirements(requirementsFor(workflow), projectRoot);
  const questions = requirements.filter((result) => result.outcome !== 'ok').map(toQuestion);
  return { ok: questions.length === 0, requirements, questions };
}
