import type { PlanningManifest, VerificationCriterion } from '@/core/types/planning.js';
import type { DefectPatternEntry } from '@/compliance/defect-patterns/types.js';
import { queryPatterns } from '@/compliance/defect-patterns/store.js';

export async function queryMatchingDefectPatterns(options: {
  stack: string;
  affectedModules: string[];
}): Promise<DefectPatternEntry[]> {
  return queryPatterns({
    stack_context: {
      frameworks: [options.stack],
      traits: options.affectedModules,
    },
    limit: 5,
    min_frequency: 3,
  });
}

export function injectDefectAdvisoryCriteria(
  manifest: PlanningManifest,
  patterns: DefectPatternEntry[],
): PlanningManifest {
  if (patterns.length === 0) {
    return manifest;
  }

  let nextId = nextCriterionId(manifest.verification_matrix);
  const allRequirementIds = manifest.requirement_graph.map((requirement) => requirement.id);
  const linkedRequirementIds =
    allRequirementIds.length > 0 ? allRequirementIds.slice(0, 3) : allRequirementIds;

  const injected: VerificationCriterion[] = patterns.slice(0, 5).map((pattern) => {
    const strength = pattern.frequency > 10 ? 'must' : 'should';
    return {
      criterion_id: `AC-${nextId++}`,
      given: `A historical defect pattern (${pattern.subcategory}) exists for this stack.`,
      when: `The affected modules ${manifest.classification.affected_modules.join(', ') || 'in scope'} change.`,
      then: `The implementation ${strength} avoid the recurring defect: ${pattern.description}`,
      proof_type: 'manual',
      status: 'uncovered',
      source: 'defect-pattern',
      linked_requirement_ids: linkedRequirementIds,
      pattern_id: pattern.pattern_id,
    };
  });

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
