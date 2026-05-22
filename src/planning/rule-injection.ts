import type {
  CompiledRulesStore,
  PlanningManifest,
  VerificationCriterion,
} from '@/core/types/planning.js';

export function injectRuleCriteria(
  manifest: PlanningManifest,
  compiledRules: CompiledRulesStore | null,
): PlanningManifest {
  if (!compiledRules || compiledRules.rules.length === 0) {
    return manifest;
  }

  let nextCriterionNumber = nextCriterionId(manifest.verification_matrix);
  const injected: VerificationCriterion[] = [];

  for (const rule of compiledRules.rules) {
    const matchingSlices = manifest.execution_slices.filter((slice) =>
      slice.touches.some((touch) =>
        rule.trigger_patterns.some((pattern) => pattern === '**' || touch.includes(pattern)),
      ),
    );

    if (matchingSlices.length === 0) {
      continue;
    }

    const linkedRequirementIds = [
      ...new Set(
        matchingSlices.flatMap((slice) =>
          slice.covers.filter((id) => /^((FR|NFR|EC|CONSTRAINT)-\d+)$/.test(id)),
        ),
      ),
    ];
    if (linkedRequirementIds.length === 0) {
      continue;
    }

    const duplicate = manifest.verification_matrix.some(
      (criterion) => criterion.rule_id === rule.rule_id,
    );
    if (duplicate) {
      continue;
    }

    injected.push({
      criterion_id: `AC-${nextCriterionNumber++}`,
      given: `The change touches files matched by rule ${rule.rule_id}.`,
      when: `Implementation for ${linkedRequirementIds.join(', ')} is completed.`,
      then: rule.summary,
      proof_type: 'manual',
      status: 'uncovered',
      source: 'compiled-rule',
      linked_requirement_ids: linkedRequirementIds,
      rule_id: rule.rule_id,
    });
  }

  return {
    ...manifest,
    verification_matrix: [...manifest.verification_matrix, ...injected],
  };
}

function nextCriterionId(criteria: VerificationCriterion[]): number {
  return (
    criteria.reduce((max, criterion) => {
      const match = criterion.criterion_id.match(/^AC-(\d+)$/);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1
  );
}
