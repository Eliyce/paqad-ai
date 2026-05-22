import type { PlanningManifest } from '@/core/types/planning.js';

import type {
  ManifestValidationError,
  ValidationIssue,
  ValidationReport,
} from './manifest-types.js';

const REQUIREMENT_ID_PATTERN = /^(FR|NFR|EC|CONSTRAINT)-\d+$/;
const SLICE_ID_PATTERN = /^SL-\d+[a-z]?$/i;
const CRITERION_ID_PATTERN = /^AC-\d+$/;
const DECISION_ID_PATTERN = /^D-\d+$/;

export function validateManifest(manifest: PlanningManifest): ValidationReport {
  const errors: ManifestValidationError[] = [];
  const warnings: ValidationIssue[] = [];

  validateSchema(manifest, errors);
  validateCoverage(manifest, errors);
  validateCycles(
    manifest.requirement_graph,
    (node) => node.id,
    (node) => node.depends_on,
    'requirement_graph',
    errors,
  );
  validateCycles(
    manifest.execution_slices,
    (slice) => slice.slice_id,
    (slice) => slice.depends_on,
    'execution_slices',
    errors,
  );
  validateCrossReferences(manifest, errors);
  validatePathSafety(manifest, errors);
  validateDescriptions(manifest, errors);
  validateProofTargets(manifest, errors);
  validateSliceBudgets(manifest, errors, warnings);

  if (manifest.classification.lane === 'fast') {
    if (manifest.execution_slices.some((slice) => slice.rollback_class !== undefined)) {
      warnings.push({
        code: 'FAST_ROLLBACK_CLASS_PRESENT',
        message: 'Fast-lane slices may omit rollback_class; present values are allowed.',
      });
    }
  } else if (manifest.execution_slices.some((slice) => slice.rollback_class === undefined)) {
    errors.push({
      severity: 'error',
      code: 'ROLLBACK_CLASS_REQUIRED',
      message: 'Graduated and full manifests require rollback_class on every execution slice.',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateSchema(manifest: PlanningManifest, errors: ManifestValidationError[]): void {
  if (manifest.plan_version < 1) {
    pushError(errors, 'PLAN_VERSION', 'plan_version must be >= 1');
  }

  if (!manifest.feature_id || !manifest.slug || !manifest.created_at) {
    pushError(errors, 'REQUIRED_FIELDS', 'feature_id, slug, and created_at are required');
  }

  for (const requirement of manifest.requirement_graph) {
    if (!REQUIREMENT_ID_PATTERN.test(requirement.id)) {
      pushError(errors, 'REQUIREMENT_ID', `Invalid requirement id: ${requirement.id}`);
    }
  }

  for (const slice of manifest.execution_slices) {
    if (!SLICE_ID_PATTERN.test(slice.slice_id)) {
      pushError(errors, 'SLICE_ID', `Invalid slice id: ${slice.slice_id}`);
    }
  }

  for (const criterion of manifest.verification_matrix) {
    if (!CRITERION_ID_PATTERN.test(criterion.criterion_id)) {
      pushError(errors, 'CRITERION_ID', `Invalid criterion id: ${criterion.criterion_id}`);
    }
  }

  for (const decision of manifest.decision_log) {
    if (!DECISION_ID_PATTERN.test(decision.decision_id)) {
      pushError(errors, 'DECISION_ID', `Invalid decision id: ${decision.decision_id}`);
    }
  }
}

function validateCoverage(manifest: PlanningManifest, errors: ManifestValidationError[]): void {
  for (const requirement of manifest.requirement_graph) {
    const criterionCovered = manifest.verification_matrix.some((criterion) =>
      criterion.linked_requirement_ids.includes(requirement.id),
    );
    if (!criterionCovered) {
      pushError(
        errors,
        'REQUIREMENT_CRITERION_COVERAGE',
        `${requirement.id} is not linked to any criterion`,
      );
    }

    const sliceCovered =
      manifest.execution_slices.length === 0 && manifest.classification.lane === 'fast'
        ? true
        : manifest.execution_slices.some((slice) => slice.covers.includes(requirement.id));
    if (!sliceCovered) {
      pushError(
        errors,
        'REQUIREMENT_SLICE_COVERAGE',
        `${requirement.id} is not covered by any execution slice`,
      );
    }
  }
}

function validateCrossReferences(
  manifest: PlanningManifest,
  errors: ManifestValidationError[],
): void {
  const requirementIds = new Set(manifest.requirement_graph.map((requirement) => requirement.id));
  const criterionIds = new Set(
    manifest.verification_matrix.map((criterion) => criterion.criterion_id),
  );
  const sliceIds = new Set(manifest.execution_slices.map((slice) => slice.slice_id));

  for (const requirement of manifest.requirement_graph) {
    for (const dependency of requirement.depends_on) {
      if (!requirementIds.has(dependency)) {
        pushError(
          errors,
          'REQUIREMENT_DEPENDS_ON',
          `${requirement.id} depends on unknown requirement ${dependency}`,
        );
      }
    }
  }

  for (const slice of manifest.execution_slices) {
    for (const dependency of slice.depends_on) {
      if (!sliceIds.has(dependency)) {
        pushError(
          errors,
          'SLICE_DEPENDS_ON',
          `${slice.slice_id} depends on unknown slice ${dependency}`,
        );
      }
    }

    for (const cover of slice.covers) {
      if (!requirementIds.has(cover) && !criterionIds.has(cover)) {
        pushError(errors, 'SLICE_COVERS', `${slice.slice_id} covers unknown id ${cover}`);
      }
    }
  }

  for (const criterion of manifest.verification_matrix) {
    for (const requirementId of criterion.linked_requirement_ids) {
      if (!requirementIds.has(requirementId)) {
        pushError(
          errors,
          'CRITERION_LINK',
          `${criterion.criterion_id} links unknown requirement ${requirementId}`,
        );
      }
    }
  }
}

function validatePathSafety(manifest: PlanningManifest, errors: ManifestValidationError[]): void {
  const paths = [
    ...manifest.requirement_graph.flatMap((requirement) => requirement.scope),
    ...manifest.execution_slices.flatMap((slice) => slice.touches),
  ];
  for (const value of paths) {
    if (value.includes('..')) {
      pushError(errors, 'PATH_TRAVERSAL', `Unsafe path detected: ${value}`);
    }
  }
}

function validateDescriptions(manifest: PlanningManifest, errors: ManifestValidationError[]): void {
  for (const requirement of manifest.requirement_graph) {
    if (requirement.description.length > 120) {
      pushError(
        errors,
        'REQUIREMENT_DESCRIPTION',
        `${requirement.id} description exceeds 120 characters`,
      );
    }
  }

  for (const slice of manifest.execution_slices) {
    if (slice.goal.length > 80) {
      pushError(errors, 'SLICE_GOAL', `${slice.slice_id} goal exceeds 80 characters`);
    }
  }
}

function validateProofTargets(manifest: PlanningManifest, errors: ManifestValidationError[]): void {
  for (const criterion of manifest.verification_matrix) {
    if (criterion.proof_type !== 'automated') {
      continue;
    }

    if (!criterion.proof_target) {
      pushError(errors, 'PROOF_TARGET_REQUIRED', `${criterion.criterion_id} requires proof_target`);
      continue;
    }

    if (!/\.(test|spec)\.[jt]sx?$/.test(criterion.proof_target)) {
      pushError(
        errors,
        'PROOF_TARGET_EXTENSION',
        `${criterion.criterion_id} proof_target must end with a test extension`,
      );
    }
  }
}

function validateSliceBudgets(
  manifest: PlanningManifest,
  errors: ManifestValidationError[],
  warnings: ValidationIssue[],
): void {
  const totalOverrides = manifest.execution_slices.reduce(
    (sum, slice) => sum + (slice.token_budget ?? 0),
    0,
  );

  for (const slice of manifest.execution_slices) {
    if (slice.token_budget !== undefined && slice.token_budget <= 0) {
      pushError(
        errors,
        'SLICE_TOKEN_BUDGET',
        `${slice.slice_id} token_budget must be greater than zero`,
      );
    }
  }

  if (totalOverrides > 15000) {
    warnings.push({
      code: 'SLICE_TOKEN_BUDGET_OVERRUN',
      message: `Slice token_budget overrides exceed the default total task budget (${totalOverrides} > 15000).`,
    });
  }
}

function validateCycles<T>(
  items: T[],
  idOf: (item: T) => string,
  depsOf: (item: T) => string[],
  label: string,
  errors: ManifestValidationError[],
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(items.map((item) => [idOf(item), item]));

  const visit = (id: string, trail: string[]): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      pushError(errors, 'CYCLE', `Cycle detected in ${label}: ${[...trail, id].join(' -> ')}`);
      return;
    }
    const item = byId.get(id);
    if (!item) {
      return;
    }
    visiting.add(id);
    for (const dep of depsOf(item)) {
      visit(dep, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of byId.keys()) {
    visit(id, []);
  }
}

function pushError(errors: ManifestValidationError[], code: string, message: string): void {
  errors.push({ severity: 'error', code, message });
}
