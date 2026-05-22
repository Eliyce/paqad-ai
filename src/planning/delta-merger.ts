import type {
  ExecutionSlice,
  ManifestDelta,
  PlanningManifest,
  RequirementNode,
  VerificationCriterion,
} from '@/core/types/planning.js';

export function mergeDeltaManifest(
  base: PlanningManifest,
  delta: PlanningManifest,
): PlanningManifest {
  return {
    ...base,
    ...delta,
    requirement_graph: mergeById(
      base.requirement_graph,
      delta.requirement_graph,
      (item) => item.id,
    ),
    execution_slices: mergeById(
      base.execution_slices,
      delta.execution_slices,
      (item) => item.slice_id,
    ),
    verification_matrix: mergeById(
      base.verification_matrix,
      delta.verification_matrix,
      (item) => item.criterion_id,
    ),
    decision_log: mergeById(base.decision_log, delta.decision_log, (item) => item.decision_id),
    doc_targets: delta.doc_targets.length > 0 ? delta.doc_targets : base.doc_targets,
    regression_watch:
      delta.regression_watch.length > 0 ? delta.regression_watch : base.regression_watch,
  };
}

export function computeDelta(base: PlanningManifest, updated: PlanningManifest): ManifestDelta {
  return {
    requirement_graph: diffById(
      base.requirement_graph,
      updated.requirement_graph,
      (item) => item.id,
    ),
    execution_slices: diffById(
      base.execution_slices,
      updated.execution_slices,
      (item) => item.slice_id,
    ),
    verification_matrix: diffById(
      base.verification_matrix,
      updated.verification_matrix,
      (item) => item.criterion_id,
    ),
    decision_log: {
      added: updated.decision_log.filter(
        (item) => !base.decision_log.some((current) => current.decision_id === item.decision_id),
      ),
    },
  };
}

function mergeById<T>(base: T[], updated: T[], idOf: (item: T) => string): T[] {
  const merged = new Map(base.map((item) => [idOf(item), item]));
  for (const item of updated) {
    merged.set(idOf(item), item);
  }
  return [...merged.values()];
}

function diffById<T extends RequirementNode | ExecutionSlice | VerificationCriterion>(
  base: T[],
  updated: T[],
  idOf: (item: T) => string,
): {
  added: T[];
  changed: Array<{ id: string; field: string; old_value: unknown; new_value: unknown }>;
  removed: T[];
} {
  const baseMap = new Map(base.map((item) => [idOf(item), item]));
  const updatedMap = new Map(updated.map((item) => [idOf(item), item]));

  const added = updated.filter((item) => !baseMap.has(idOf(item)));
  const removed = base.filter((item) => !updatedMap.has(idOf(item)));
  const changed = updated.flatMap((item) => {
    const id = idOf(item);
    const previous = baseMap.get(id);
    if (!previous) {
      return [];
    }

    return Object.entries(item).flatMap(([field, value]) => {
      const oldValue = (previous as unknown as Record<string, unknown>)[field];
      return JSON.stringify(oldValue) === JSON.stringify(value)
        ? []
        : [{ id, field, old_value: oldValue, new_value: value }];
    });
  });

  return { added, changed, removed };
}
