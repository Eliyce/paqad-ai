import type { PlanningManifest } from '@/core/types/planning.js';

export function createManifest(overrides: Partial<PlanningManifest> = {}): PlanningManifest {
  return {
    plan_version: 1,
    plan_mode: 'full',
    feature_id: 'feat-planning-manifest',
    slug: 'planning-manifest',
    created_at: '2026-04-10T00:00:00.000Z',
    base_manifest_hash: null,
    classification: {
      workflow: 'feature-development',
      complexity: 'medium',
      risk: 'low',
      lane: 'graduated',
      domain: 'coding',
      stack: 'node-cli',
      scope: 'single-module',
      affected_modules: ['planning'],
      affected_module_count: 1,
      api_impact: null,
      ui_impact: null,
    },
    requirement_graph: [
      {
        id: 'FR-1',
        type: 'functional',
        description: 'Generate a planning manifest.',
        depends_on: [],
        scope: ['src/planning/index.ts'],
        risk: 'low',
      },
    ],
    execution_slices: [
      {
        slice_id: 'SL-1',
        goal: 'Implement planning manifest support.',
        covers: ['FR-1', 'AC-1'],
        depends_on: [],
        touches: ['src/planning/index.ts'],
        rollback_class: 'safe',
      },
    ],
    verification_matrix: [
      {
        criterion_id: 'AC-1',
        given: 'a feature request exists',
        when: 'planning runs',
        then: 'a manifest is produced',
        proof_type: 'automated',
        proof_target: 'tests/unit/planning/generated.test.ts',
        status: 'uncovered',
        source: 'planned',
        linked_requirement_ids: ['FR-1'],
      },
    ],
    decision_log: [
      {
        decision_id: 'D-1',
        choice: 'Use YAML as the planning contract.',
        reason: 'Downstream systems can read it deterministically.',
        alternatives_rejected: [
          {
            alternative: 'Keep prose story specs',
            rejection_reason: 'It requires reparsing and redundant model calls.',
          },
        ],
        linked_requirements: ['FR-1'],
        reversibility: 'moderate',
      },
    ],
    doc_targets: [],
    regression_watch: [],
    ...overrides,
  };
}
