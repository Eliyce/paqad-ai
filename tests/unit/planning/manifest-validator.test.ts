import { validateManifest } from '@/planning/manifest-validator.js';

import { createManifest } from './fixtures.js';

describe('manifest-validator', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(createManifest());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('catches schema, coverage, cycle, path, length, and proof target problems', () => {
    const manifest = createManifest({
      requirement_graph: [
        {
          id: 'bad',
          type: 'functional',
          description: 'x'.repeat(121),
          depends_on: ['bad'],
          scope: ['../escape.ts'],
          risk: 'low',
        },
      ],
      execution_slices: [
        {
          slice_id: 'bad',
          goal: 'x'.repeat(81),
          covers: ['FR-99'],
          depends_on: ['bad'],
          touches: ['../escape.ts'],
        },
      ],
      verification_matrix: [
        {
          criterion_id: 'bad',
          given: 'g',
          when: 'w',
          then: 't',
          proof_type: 'automated',
          proof_target: 'tests/unit/planning/generated.ts',
          status: 'uncovered',
          source: 'planned',
          linked_requirement_ids: ['FR-99'],
        },
      ],
      decision_log: [{ ...createManifest().decision_log[0], decision_id: 'bad' }],
    });

    const result = validateManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        'REQUIREMENT_ID',
        'SLICE_ID',
        'CRITERION_ID',
        'DECISION_ID',
        'REQUIREMENT_CRITERION_COVERAGE',
        'REQUIREMENT_SLICE_COVERAGE',
        'CYCLE',
        'SLICE_COVERS',
        'CRITERION_LINK',
        'PATH_TRAVERSAL',
        'REQUIREMENT_DESCRIPTION',
        'SLICE_GOAL',
        'PROOF_TARGET_EXTENSION',
        'ROLLBACK_CLASS_REQUIRED',
      ]),
    );
  });

  it('allows fast-lane manifests to omit decision logs and rollback classes', () => {
    const fastManifest = createManifest({
      classification: { ...createManifest().classification, lane: 'fast' },
      execution_slices: [],
      decision_log: [],
    });

    const result = validateManifest(fastManifest);

    expect(result.valid).toBe(true);
  });

  it('covers visited and missing-node cycle traversal branches', () => {
    const manifest = createManifest({
      requirement_graph: [
        createManifest().requirement_graph[0],
        {
          id: 'FR-2',
          type: 'functional',
          description: 'Follow-on requirement.',
          depends_on: ['FR-1', 'FR-99'],
          scope: ['src/planning/index.ts'],
          risk: 'low',
        },
      ],
      verification_matrix: [
        ...createManifest().verification_matrix,
        {
          criterion_id: 'AC-2',
          given: 'g',
          when: 'w',
          then: 't',
          proof_type: 'manual',
          status: 'uncovered',
          source: 'planned',
          linked_requirement_ids: ['FR-2'],
        },
      ],
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          depends_on: ['SL-99'],
          covers: ['FR-1', 'FR-2', 'AC-1', 'AC-2'],
        },
      ],
    });

    const result = validateManifest(manifest);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['REQUIREMENT_DEPENDS_ON', 'SLICE_DEPENDS_ON']),
    );
  });

  it('requires proof targets for automated criteria', () => {
    const manifest = createManifest({
      verification_matrix: [
        {
          ...createManifest().verification_matrix[0],
          proof_target: undefined,
        },
      ],
    });

    const result = validateManifest(manifest);
    expect(result.errors.map((error) => error.code)).toContain('PROOF_TARGET_REQUIRED');
  });

  it('warns on fast-lane rollback metadata and validates missing top-level fields', () => {
    const manifest = createManifest({
      plan_version: 0,
      feature_id: '',
      slug: '',
      created_at: '',
      classification: { ...createManifest().classification, lane: 'fast' },
      execution_slices: [{ ...createManifest().execution_slices[0], rollback_class: 'safe' }],
    });

    const result = validateManifest(manifest);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['PLAN_VERSION', 'REQUIRED_FIELDS']),
    );
    expect(result.warnings.map((warning) => warning.code)).toContain('FAST_ROLLBACK_CLASS_PRESENT');
  });

  it('validates slice token budgets and warns when overrides exceed the default pool', () => {
    const manifest = createManifest({
      execution_slices: [
        { ...createManifest().execution_slices[0], slice_id: 'SL-1', token_budget: -1 },
        { ...createManifest().execution_slices[0], slice_id: 'SL-2', token_budget: 16_000 },
      ],
    });

    const result = validateManifest(manifest);
    expect(result.errors.map((error) => error.code)).toContain('SLICE_TOKEN_BUDGET');
    expect(result.warnings.map((warning) => warning.code)).toContain('SLICE_TOKEN_BUDGET_OVERRUN');
  });
});
