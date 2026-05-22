import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

import { PATHS, REGISTRIES } from '@/core/constants/paths.js';
import { defaultFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import { fixtureClassification } from '../pipeline/shared.fixture.js';

function createPhaseContext(overrides: Record<string, unknown> = {}) {
  return {
    project_root: '/tmp/phase-project',
    lane: 'standard',
    classification: fixtureClassification(),
    started_at: new Date().toISOString(),
    phases: [],
    feature_policy: null,
    policy_warnings: [],
    ...overrides,
  };
}

describe('coverage smoke imports', () => {
  it('loads type and interface modules at runtime', async () => {
    const modules = await Promise.all([
      import('@/adapters/adapter.interface.js'),
      import('@/cache/types.js'),
      import('@/context/types.js'),
      import('@/core/types/design-tokens.js'),
      import('@/core/types/document-generation.js'),
      import('@/core/types/feature-development-policy.js'),
      import('@/core/types/introspection.js'),
      import('@/core/types/onboarding.js'),
      import('@/core/types/pack.js'),
      import('@/core/types/repository.js'),
      import('@/core/types/template.js'),
      import('@/introspection/ecosystems/types.js'),
      import('@/patterns/types.js'),
      import('@/pipeline/phases/phase.interface.js'),
      import('@/session/types.js'),
      import('@/verification/gates/gate.interface.js'),
      import('@/workflows/types.js'),
    ]);

    expect(modules).toHaveLength(17);
    expect(modules.every((module) => typeof module === 'object')).toBe(true);
  });
});

describe('registry generation', () => {
  it('discovers modules from multiple roots and writes initial registry files', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'paqad-registry-'));
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await Promise.all([
      mkdir(join(projectRoot, 'docs/modules/payments'), { recursive: true }),
      mkdir(join(projectRoot, 'app/Billing'), { recursive: true }),
      mkdir(join(projectRoot, 'lib/shared'), { recursive: true }),
      mkdir(join(projectRoot, 'src/.hidden'), { recursive: true }),
      writeFile(join(projectRoot, 'src/readme.md'), 'not a directory'),
    ]);

    const { discoverModules, generateInitialRegistries } =
      await import('@/onboarding/registry-generator.js');

    await expect(discoverModules(projectRoot)).resolves.toEqual([
      'Billing',
      'core',
      'payments',
      'shared',
    ]);

    const generated = await generateInitialRegistries(projectRoot);
    expect(generated).toHaveLength(REGISTRIES.length + 2);
    expect(generated[0]).toMatchObject({
      path: '.paqad/indexes/registry-status.json',
      autoUpdate: true,
    });
    expect(generated[1]).toMatchObject({
      path: PATHS.GLOSSARY,
      content: '# Glossary\n\n',
      autoUpdate: false,
    });
    expect(generated.find((entry) => entry.path.endsWith('module-registry.md'))).toMatchObject({
      path: join(PATHS.REGISTRIES_DIR, 'module-registry.md'),
      content: expect.stringContaining('- payments'),
      autoUpdate: false,
    });
    expect(generated.find((entry) => entry.path.endsWith('feature-registry.md'))).toMatchObject({
      path: join(PATHS.REGISTRIES_DIR, 'feature-registry.md'),
      content: '# feature-registry.md\n\n',
      autoUpdate: false,
    });
  });
});

describe('pipeline phase fallbacks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('covers the summary and fallback branches for lightweight phases', async () => {
    const { ImplementationPhase } = await import('@/pipeline/phases/implementation.js');
    const { SpecWritingPhase } = await import('@/pipeline/phases/spec-writing.js');
    const { StoryPlanningPhase } = await import('@/pipeline/phases/story-planning.js');
    const { ImplementationReviewPhase, selectReviewMode } =
      await import('@/pipeline/phases/impl-review.js');

    const policy = defaultFeatureDevelopmentPolicy();

    await expect(new ImplementationPhase().execute(createPhaseContext())).resolves.toMatchObject({
      phase: 'implementation',
      status: 'pass',
      summary: 'Implementation completed',
    });
    await expect(
      new ImplementationPhase().execute(createPhaseContext({ feature_policy: policy })),
    ).resolves.toMatchObject({
      summary:
        'Implementation completed (1 instruction(s), 2 required input(s), 1 expected artifact(s))',
    });

    const projectRoot = await mkdtemp(join(tmpdir(), 'paqad-slice-phase-'));
    await mkdir(join(projectRoot, '.paqad/specs'), { recursive: true });
    await writeFile(
      join(projectRoot, '.paqad/specs', 'planning-manifest.yaml'),
      YAML.stringify({
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
            covers: ['FR-1'],
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
        decision_log: [],
        doc_targets: [],
        regression_watch: [],
      }),
    );

    await expect(
      new ImplementationPhase().execute(
        createPhaseContext({
          project_root: projectRoot,
        }),
      ),
    ).resolves.toMatchObject({
      summary: 'Slice execution initialized (1 slice(s), current: SL-1)',
      artifacts: [join(projectRoot, '.paqad/specs/planning-manifest.execution.json')],
    });

    await writeFile(
      join(projectRoot, '.paqad/specs', 'fast-manifest.yaml'),
      YAML.stringify({
        plan_version: 1,
        plan_mode: 'full',
        feature_id: 'feat-fast',
        slug: 'fast-manifest',
        created_at: '2026-04-10T00:00:00.000Z',
        base_manifest_hash: null,
        classification: {
          workflow: 'feature-development',
          complexity: 'low',
          risk: 'low',
          lane: 'fast',
          domain: 'coding',
          stack: 'node-cli',
          scope: 'single-module',
          affected_modules: ['planning'],
          affected_module_count: 1,
          api_impact: null,
          ui_impact: null,
        },
        requirement_graph: [],
        execution_slices: [],
        verification_matrix: [],
        decision_log: [],
        doc_targets: [],
        regression_watch: [],
      }),
    );

    await expect(
      new ImplementationPhase().execute(
        createPhaseContext({
          project_root: projectRoot,
          classification: { ...fixtureClassification(), base_manifest_slug: 'fast-manifest' },
        }),
      ),
    ).resolves.toMatchObject({
      summary: 'Slice execution initialized (0 slice(s), no eligible slice)',
    });

    await writeFile(
      join(projectRoot, '.paqad/specs', 'warning-manifest.yaml'),
      YAML.stringify({
        plan_version: 1,
        plan_mode: 'full',
        feature_id: 'feat-warning',
        slug: 'warning-manifest',
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
            goal: 'Over-budget slice one.',
            covers: ['FR-1'],
            depends_on: [],
            touches: ['src/planning/index.ts'],
            rollback_class: 'safe',
            token_budget: 10000,
          },
          {
            slice_id: 'SL-2',
            goal: 'Over-budget slice two.',
            covers: ['FR-1'],
            depends_on: ['SL-1'],
            touches: ['src/planning/other.ts'],
            rollback_class: 'safe',
            token_budget: 10000,
          },
        ],
        verification_matrix: [],
        decision_log: [],
        doc_targets: [],
        regression_watch: [],
      }),
    );

    await expect(
      new ImplementationPhase().execute(
        createPhaseContext({
          project_root: projectRoot,
          feature_policy: policy,
          classification: { ...fixtureClassification(), base_manifest_slug: 'warning-manifest' },
        }),
      ),
    ).resolves.toMatchObject({
      summary: expect.stringContaining(
        'warnings: Slice token_budget overrides exceed the total task budget',
      ),
    });

    await expect(new SpecWritingPhase().execute(createPhaseContext())).resolves.toMatchObject({
      phase: 'specification',
      summary: 'Specification written',
    });
    await expect(
      new SpecWritingPhase().execute(createPhaseContext({ feature_policy: policy })),
    ).resolves.toMatchObject({
      summary:
        'Specification written (1 instruction(s), 1 required input(s), 1 expected artifact(s))',
    });

    await expect(new StoryPlanningPhase().execute(createPhaseContext())).resolves.toMatchObject({
      phase: 'sequence-planning',
      summary: 'Story sequence planned',
    });
    await expect(
      new StoryPlanningPhase().execute(createPhaseContext({ feature_policy: policy })),
    ).resolves.toMatchObject({
      summary:
        'Story sequence planned (reads 2 path(s), 2 instruction(s), 2 required input(s), 1 expected artifact(s))',
    });

    await expect(
      new ImplementationReviewPhase().execute(createPhaseContext({ lane: 'slow' })),
    ).resolves.toMatchObject({
      phase: 'implementation-review',
      summary: 'Implementation review passed (full, fresh)',
    });
    await expect(
      new ImplementationReviewPhase().execute(
        createPhaseContext({ feature_policy: policy, lane: 'graduated' }),
      ),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('standard, fresh;'),
    });

    expect(selectReviewMode(true, 0.2)).toBe('diff');
    expect(selectReviewMode(true, 0.7)).toBe('fresh');
  });

  it('covers verification phase pass and failure branches', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'paqad-verification-'));
    const { VerificationPhase } = await import('@/pipeline/phases/verification.js');
    const { writeProjectProfile } = await import('@/core/project-profile.js');

    const policy = defaultFeatureDevelopmentPolicy();

    writeProjectProfile(projectRoot, {
      active_capabilities: ['content'],
      commands: {
        lint: 'pnpm lint',
      },
    });

    await expect(
      new VerificationPhase().execute(
        createPhaseContext({
          project_root: projectRoot,
          feature_policy: policy,
        }),
      ),
    ).resolves.toMatchObject({
      phase: 'verification-gates',
      status: 'fail',
      summary: expect.stringContaining('Verification blocked'),
    });

    writeProjectProfile(projectRoot, {
      active_capabilities: ['content'],
      commands: {
        format: 'pnpm format',
        test: 'pnpm test',
        build: 'pnpm build',
      },
    });

    await expect(
      new VerificationPhase().execute(
        createPhaseContext({
          project_root: projectRoot,
          feature_policy: policy,
        }),
      ),
    ).resolves.toMatchObject({
      phase: 'verification-gates',
      status: 'pass',
      summary: expect.stringContaining('commands: pnpm format; pnpm test; pnpm build'),
    });
  });

  it('covers documentation update success, failure, and onboarding-aware feature branch', async () => {
    vi.resetModules();
    const run = vi.fn();
    const DocumentationWorkflow = vi.fn(() => ({ run }));
    const readProjectProfile = vi.fn();

    vi.doMock('@/document/workflow.js', () => ({
      DocumentationWorkflow,
    }));
    vi.doMock('@/core/project-profile.js', () => ({
      readProjectProfile,
    }));

    const { DocumentationUpdatePhase } = await import('@/pipeline/phases/doc-update.js');

    readProjectProfile.mockReturnValue({ project: { name: 'demo' } });
    run.mockResolvedValueOnce({
      steps: ['scan', 'write'],
      generated: ['docs/modules/core/spec.md'],
      module_docs_pending_map_review: false,
      module_map_path: null,
      module_map_low_confidence_modules: [],
      orphaned_module_dirs: [],
    });
    await expect(
      new DocumentationUpdatePhase().execute(
        createPhaseContext({
          classification: fixtureClassification({ workflow: 'documentation-update' }),
        }),
      ),
    ).resolves.toMatchObject({
      phase: 'documentation-update',
      status: 'pass',
      summary: 'Documentation workflow completed in 2 step(s)',
      artifacts: ['docs/modules/core/spec.md'],
    });

    readProjectProfile.mockReturnValue({ project: { name: 'demo' } });
    run.mockRejectedValueOnce(new Error('boom'));
    await expect(
      new DocumentationUpdatePhase().execute(
        createPhaseContext({
          classification: fixtureClassification({ output_type: 'documentation' }),
        }),
      ),
    ).resolves.toMatchObject({
      phase: 'documentation-update',
      status: 'fail',
      summary: 'boom',
    });

    readProjectProfile.mockReturnValue({ project: { name: 'demo' } });
    run.mockRejectedValueOnce('not-an-error');
    await expect(
      new DocumentationUpdatePhase().execute(
        createPhaseContext({
          classification: fixtureClassification({ workflow: 'documentation-update' }),
        }),
      ),
    ).resolves.toMatchObject({
      phase: 'documentation-update',
      status: 'fail',
      summary: 'Documentation workflow failed',
    });

    readProjectProfile.mockReturnValue({ project: { name: 'demo' } });
    run.mockResolvedValueOnce({
      steps: ['scan', 'write', 'sync'],
      generated: ['docs/modules/billing/features/payments/technical.md'],
      module_docs_pending_map_review: false,
      module_map_path: null,
      module_map_low_confidence_modules: [],
      orphaned_module_dirs: [],
    });
    await expect(
      new DocumentationUpdatePhase().execute(
        createPhaseContext({
          project_root: '/tmp/onboarded-project',
          classification: fixtureClassification({ workflow: 'feature-development' }),
        }),
      ),
    ).resolves.toMatchObject({
      phase: 'documentation-update',
      status: 'pass',
      summary: 'Documentation workflow completed in 3 step(s)',
      artifacts: ['docs/modules/billing/features/payments/technical.md'],
    });

    readProjectProfile.mockReturnValue(null);
    await expect(
      new DocumentationUpdatePhase().execute(createPhaseContext()),
    ).resolves.toMatchObject({
      phase: 'documentation-update',
      status: 'pass',
      summary: 'Canonical docs updated',
    });

    vi.doUnmock('@/document/workflow.js');
    vi.doUnmock('@/core/project-profile.js');
    vi.resetModules();
  });
});
