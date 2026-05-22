import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

const { mockPromptForDecision } = vi.hoisted(() => ({
  mockPromptForDecision: vi.fn(),
}));

vi.mock('@/cli/ui/decision-screen.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/ui/decision-screen.js')>(
    '@/cli/ui/decision-screen.js',
  );
  return {
    ...actual,
    promptForDecision: mockPromptForDecision,
  };
});

import {
  appendPlanningAudit,
  assembleSliceContext,
  attemptEscalationReplan,
  buildDependencyQueue,
  buildSliceRetryFeedback,
  collectBlockedSlices,
  computeSliceBudgetPlan,
  detectExecutionManifestSlug,
  estimatePriorSliceSummaryTokens,
  ExecutionTracker,
  createSliceEscalationReport,
  resolveSliceExecutionBudget,
  SliceEscalationStore,
  SliceCircuitBreaker,
  SliceCheckpointStore,
  SliceExecutor,
  verifySlicePreconditions,
} from '@/planning/index.js';
import { PATHS } from '@/core/constants/paths.js';

import { createManifest } from './fixtures.js';

describe('slice execution helpers', () => {
  beforeEach(() => {
    mockPromptForDecision.mockReset();
  });
  it('orders slices deterministically and collects blocked descendants', () => {
    const manifest = createManifest({
      execution_slices: [
        {
          slice_id: 'SL-10',
          goal: 'late slice',
          covers: ['FR-1'],
          depends_on: ['SL-2'],
          touches: ['src/planning/late.ts'],
          rollback_class: 'safe',
        },
        {
          slice_id: 'SL-2',
          goal: 'mid slice',
          covers: ['FR-1'],
          depends_on: ['SL-1'],
          touches: ['src/planning/mid.ts'],
          rollback_class: 'safe',
        },
        {
          slice_id: 'SL-1',
          goal: 'first slice',
          covers: ['FR-1'],
          depends_on: [],
          touches: ['src/planning/first.ts'],
          rollback_class: 'safe',
        },
      ],
    });

    expect(buildDependencyQueue(manifest.execution_slices).map((slice) => slice.slice_id)).toEqual([
      'SL-1',
      'SL-2',
      'SL-10',
    ]);
    expect(collectBlockedSlices(manifest.execution_slices, 'SL-2')).toEqual(['SL-10']);
    expect(
      collectBlockedSlices(
        [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
            depends_on: [],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-3',
            depends_on: ['SL-1'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-4',
            depends_on: ['SL-2', 'SL-3'],
          },
        ],
        'SL-1',
      ),
    ).toEqual(['SL-2', 'SL-3', 'SL-4']);
    expect(collectBlockedSlices(manifest.execution_slices, 'SL-10')).toEqual([]);
    expect(() =>
      buildDependencyQueue([
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          depends_on: ['SL-2'],
        },
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-2',
          depends_on: ['SL-1'],
        },
      ]),
    ).toThrow(/cycle/i);
  });

  it('computes per-slice budgets and respects manual overrides', () => {
    const plan = computeSliceBudgetPlan(
      [
        { ...createManifest().execution_slices[0], slice_id: 'SL-1', token_budget: 6000 },
        { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
      ],
      10000,
    );

    expect(plan.perSlice['SL-1']).toBe(6000);
    expect(plan.perSlice['SL-2']).toBe(5200);
    expect(plan.summary.per_slice_base).toBe(5000);
    expect(
      computeSliceBudgetPlan(
        [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1', token_budget: 12_000 },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2', token_budget: 12_000 },
        ],
        10_000,
      ).warnings,
    ).toHaveLength(1);
    expect(
      computeSliceBudgetPlan(
        [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1', token_budget: 1000 },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2', token_budget: 2000 },
        ],
        5000,
      ).perSlice,
    ).toEqual({
      'SL-1': 1000,
      'SL-2': 2000,
    });
    expect(
      computeSliceBudgetPlan(
        [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
            rollback_class: 'destructive',
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            rollback_class: 'needs-migration',
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-3',
            rollback_class: 'safe',
          },
        ],
        1000,
      ).perSlice,
    ).toEqual({
      'SL-1': 527,
      'SL-2': 422,
      'SL-3': 351,
    });
  });

  it('persists execution tracker state and derives status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-tracker-'));
    try {
      const trackerStore = new ExecutionTracker();
      const manifest = createManifest({
        execution_slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
        ],
      });

      const tracker = await trackerStore.initialize(root, manifest);
      expect(tracker.status).toBe('not-started');

      trackerStore.markSliceStatus(tracker, 'SL-1', 'in-progress', 1);
      await trackerStore.save(root, tracker);

      const loaded = await trackerStore.load(root, manifest.slug);
      expect(loaded).toMatchObject({
        status: 'in-progress',
        slices: {
          'SL-1': expect.objectContaining({
            status: 'in-progress',
            attempt: 1,
          }),
        },
      });

      trackerStore.markSliceStatus(tracker, 'SL-1', 'completed', 1);
      expect(tracker.status).toBe('in-progress');

      trackerStore.markSliceStatus(tracker, 'SL-2', 'escalated', 2);
      expect(tracker.status).toBe('partial');
      await trackerStore.save(root, tracker);
      const escalated = await trackerStore.load(root, manifest.slug);
      expect(escalated?.slices['SL-2'].status).toBe('escalated');

      const failedManifest = createManifest({ slug: 'failed-manifest' });
      const failedTracker = await trackerStore.initialize(root, failedManifest);
      trackerStore.markSliceStatus(failedTracker, 'SL-1', 'escalated', 1);
      expect(failedTracker.status).toBe('failed');
      expect(() => trackerStore.markSliceStatus(failedTracker, 'SL-99', 'failed', 1)).toThrow(
        /Unknown slice progress entry/,
      );
      expect(() =>
        trackerStore.applySliceMetrics(failedTracker, 'SL-99', {
          tokens_used: 1,
          tests_passed: 1,
          tests_failed: 0,
          docs_updated: 0,
          scope_clean: true,
        }),
      ).toThrow(/Unknown slice progress entry/);
      trackerStore.resetSlices(failedTracker, ['SL-404']);
      trackerStore.applySliceMetrics(failedTracker, 'SL-1', {
        tokens_used: 50,
        tests_passed: 1,
        tests_failed: 0,
        docs_updated: 0,
        scope_clean: true,
      });
      const recomputeManifest = createManifest({
        slug: 'recompute-manifest',
        execution_slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
        ],
      });
      const recomputeTracker = await trackerStore.initialize(root, recomputeManifest);
      trackerStore.applySliceMetrics(recomputeTracker, 'SL-1', {
        tokens_used: 50,
        tests_passed: 1,
        tests_failed: 0,
        docs_updated: 0,
        scope_clean: true,
      });
      trackerStore.applySliceMetrics(recomputeTracker, 'SL-2', {
        tokens_used: 70,
        tests_passed: 1,
        tests_failed: 0,
        docs_updated: 0,
        scope_clean: true,
      });
      trackerStore.resetSlices(recomputeTracker, ['SL-1']);
      expect(recomputeTracker.token_budget.consumed).toBe(70);
      expect(recomputeTracker.token_budget.remaining).toBe(
        recomputeTracker.token_budget.total - 70,
      );
      writeFileSync(join(root, '.paqad/specs/corrupt.execution.json'), '{');
      expect(await trackerStore.load(root, 'corrupt')).toBeNull();

      const singleTracker = await trackerStore.initialize(
        root,
        createManifest({ slug: 'single-manifest' }),
      );
      trackerStore.markSliceStatus(singleTracker, 'SL-1', 'completed', 1);
      expect(singleTracker.status).toBe('completed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('initializes zero-slice trackers as completed and writes predictable paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-tracker-empty-'));
    try {
      const trackerStore = new ExecutionTracker();
      const manifest = createManifest({
        slug: 'empty-manifest',
        execution_slices: [],
      });

      const tracker = await trackerStore.initialize(root, manifest);
      expect(tracker.status).toBe('completed');
      expect(
        readFileSync(join(root, '.paqad/specs/empty-manifest.execution.json'), 'utf8'),
      ).toContain('"status": "completed"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes checkpoints, builds prior summaries, and verifies export preconditions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-checkpoint-'));
    try {
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const PlannedValue = true;\n');

      const store = new SliceCheckpointStore();
      await store.save(root, 'planning-manifest', {
        slice_id: 'SL-1',
        goal: 'first',
        status: 'completed',
        attempt: 1,
        started_at: '2026-04-10T00:00:00.000Z',
        completed_at: '2026-04-10T00:01:00.000Z',
        tokens_used: 100,
        files_changed: ['src/planning/index.ts'],
        exports_created: ['PlannedValue (src/planning/index.ts)'],
        decisions_made: [],
        criteria_results: { 'AC-1': 'covered' },
        doc_targets_updated: ['DOC-1'],
        regression_results: { 'REG-1': 'passing' },
        gate_result: { status: 'pass' },
        compression_stats: {
          raw_context_tokens: 1000,
          summary_tokens: 100,
          compression_ratio: 0.1,
        },
      });

      const summaries = await store.loadSummaries(root, 'planning-manifest', ['SL-1']);
      expect(summaries).toEqual([
        expect.objectContaining({
          slice_id: 'SL-1',
          exports_available: ['PlannedValue (src/planning/index.ts)'],
          files_changed: ['src/planning/index.ts'],
        }),
      ]);
      expect(estimatePriorSliceSummaryTokens(summaries[0]!)).toBeLessThan(200);
      await store.save(root, 'planning-manifest', {
        ...(await store.load(root, 'planning-manifest', 'SL-1'))!,
        slice_id: 'SL-2',
        status: 'failed',
      });
      expect(await store.loadSummaries(root, 'planning-manifest', ['SL-1', 'SL-2'])).toHaveLength(
        1,
      );
      expect(await store.load(root, 'planning-manifest', 'missing')).toBeNull();
      writeFileSync(join(root, '.paqad/specs/planning-manifest.checkpoints/bad.json'), '{');
      expect(await store.load(root, 'planning-manifest', 'bad')).toBeNull();

      await expect(
        verifySlicePreconditions(
          root,
          'planning-manifest',
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            preconditions: ['SL-1 PlannedValue exported (src/planning/index.ts)'],
          },
          store,
        ),
      ).resolves.toEqual({ met: true, blockedBy: [] });
      await expect(
        verifySlicePreconditions(
          root,
          'planning-manifest',
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-3',
            preconditions: ['free-form note', 'SL-1 MissingValue exported (src/planning/index.ts)'],
          },
          store,
        ),
      ).resolves.toEqual({
        met: false,
        blockedBy: ['SL-1 MissingValue exported (src/planning/index.ts)'],
      });
      await expect(
        verifySlicePreconditions(
          root,
          'planning-manifest',
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-4',
            preconditions: ['SL-1 PlannedValue exported (src/planning/missing.ts)'],
          },
          store,
        ),
      ).resolves.toEqual({
        met: false,
        blockedBy: ['SL-1 PlannedValue exported (src/planning/missing.ts)'],
      });
      await expect(
        verifySlicePreconditions(
          root,
          'planning-manifest',
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-5',
            preconditions: ['SL-1'],
          },
          store,
        ),
      ).resolves.toEqual({ met: true, blockedBy: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('assembles slice-scoped context from the manifest', () => {
    const manifest = createManifest({
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          touches: ['src/planning/index.ts', 'src/planning/extra.ts'],
        },
      ],
      decision_log: [
        ...createManifest().decision_log,
        {
          decision_id: 'D-2',
          choice: 'Ignore other work',
          reason: 'out of scope',
          alternatives_rejected: [],
          linked_requirements: ['FR-999'],
          reversibility: 'easy',
        },
      ],
      doc_targets: [
        {
          target_id: 'DOC-1',
          file: 'docs/modules/planning/technical.md',
          section: 'Overview',
          reason: 'Document slice',
          slice_id: 'SL-1',
          status: 'pending',
        },
      ],
      regression_watch: [
        {
          entry_id: 'REG-1',
          test_file: 'tests/unit/planning/generated.test.ts',
          touched_file: 'src/planning/index.ts',
          slice_id: 'SL-1',
          status: 'pending',
        },
      ],
    });

    const context = assembleSliceContext({
      manifest,
      sliceId: 'SL-1',
      priorSlices: [],
      existingImplementations: [
        {
          file_path: 'src/planning/index.ts',
          function_name: 'stableApi',
          description: 'existing helper',
          relevance_score: 0.9,
        },
        {
          file_path: 'src/other.ts',
          function_name: 'skipMe',
          description: 'irrelevant helper',
          relevance_score: 0.2,
        },
      ],
      tokenBudget: 4200,
    });

    expect(context.verification_criteria).toHaveLength(1);
    expect(context.test_skeletons).toEqual(['tests/unit/planning/generated.test.ts']);
    expect(context.doc_targets).toHaveLength(1);
    expect(context.regression_entries).toHaveLength(1);
    expect(context.decision_context).toHaveLength(1);
    expect(context.existing_code_matches).toHaveLength(1);
    expect(context.token_budget).toBe(4200);
    expect(() =>
      assembleSliceContext({
        manifest,
        sliceId: 'SL-99',
        priorSlices: [],
        tokenBudget: 10,
      }),
    ).toThrow(/Unknown execution slice/);
  });

  it('prepares slice execution from a manifest and marks the first eligible slice in progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-executor-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
            preconditions: ['SL-1 MissingExport exported (src/planning/index.ts)'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs', `${manifest.slug}.yaml`),
        YAML.stringify(manifest),
        'utf8',
      );

      const prepared = await new SliceExecutor().prepare(root, manifest.slug);
      expect(prepared.orderedSliceIds).toEqual(['SL-1', 'SL-2']);
      expect(prepared.currentSliceId).toBe('SL-1');
      expect(prepared.context?.current_slice.slice_id).toBe('SL-1');

      const tracker = JSON.parse(
        readFileSync(join(root, '.paqad/specs', `${manifest.slug}.execution.json`), 'utf8'),
      ) as {
        status: string;
        slices: Record<string, { status: string }>;
      };
      expect(tracker.status).toBe('in-progress');
      expect(tracker.slices['SL-1'].status).toBe('in-progress');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('handles fast-lane and blocked-slice preparation branches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-fast-blocked-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });

      const fastManifest = createManifest({
        slug: 'fast-manifest',
        classification: { ...createManifest().classification, lane: 'fast' },
        execution_slices: [],
      });
      writeFileSync(
        join(root, '.paqad/specs', 'fast-manifest.yaml'),
        YAML.stringify(fastManifest),
        'utf8',
      );
      const fastPrepared = await new SliceExecutor().prepare(root, 'fast-manifest');
      expect(fastPrepared.currentSliceId).toBeNull();
      expect(fastPrepared.context).toBeNull();

      writeFileSync(join(root, 'src-export.ts'), 'export const value = 1;\n');
      const blockedManifest = createManifest({
        slug: 'blocked-manifest',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
            preconditions: ['SL-99 Missing exported (src-export.ts)'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs', 'blocked-manifest.yaml'),
        YAML.stringify(blockedManifest),
        'utf8',
      );

      const blockedPrepared = await new SliceExecutor().prepare(root, 'blocked-manifest');
      expect(blockedPrepared.currentSliceId).toBe('SL-2');
      expect(blockedPrepared.blockedSliceIds).toEqual(['SL-1']);

      writeFileSync(
        join(root, '.paqad/specs', 'all-done.yaml'),
        YAML.stringify(
          createManifest({
            slug: 'all-done',
            execution_slices: [
              { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
              { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
            ],
          }),
        ),
      );
      writeFileSync(
        join(root, '.paqad/specs', 'all-done.execution.json'),
        JSON.stringify({
          slug: 'all-done',
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 3,
          status: 'completed',
          slices: {
            'SL-1': { status: 'completed' },
            'SL-2': { status: 'blocked' },
          },
          token_budget: {
            total: 100,
            per_slice_base: 50,
            per_slice_with_buffer: 65,
            consumed: 0,
            remaining: 100,
          },
        }),
      );

      const noEligiblePrepared = await new SliceExecutor().prepare(root, 'all-done');
      expect(noEligiblePrepared.currentSliceId).toBeNull();
      expect(noEligiblePrepared.context).toBeNull();

      writeFileSync(
        join(root, '.paqad/specs', 'resumeable.yaml'),
        YAML.stringify(
          createManifest({
            slug: 'resumeable',
            execution_slices: [
              { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
              { ...createManifest().execution_slices[0], slice_id: 'SL-2', token_budget: 7777 },
            ],
          }),
        ),
      );
      writeFileSync(
        join(root, '.paqad/specs', 'resumeable.execution.json'),
        JSON.stringify({
          slug: 'resumeable',
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 2,
          status: 'in-progress',
          slices: {
            'SL-1': { status: 'completed', attempt: 1 },
            'SL-2': { status: 'pending', attempt: 3 },
          },
          token_budget: {
            total: 20_000,
            per_slice_base: 10_000,
            per_slice_with_buffer: 13_000,
            consumed: 0,
            remaining: 20_000,
          },
        }),
      );
      const resumed = await new SliceExecutor().prepare(root, 'resumeable');
      expect(resumed.currentSliceId).toBe('SL-2');
      expect(readFileSync(join(root, '.paqad/specs/resumeable.execution.json'), 'utf8')).toContain(
        '"attempt": 4',
      );
      expect(resumed.context?.token_budget).toBe(7777);

      writeFileSync(
        join(root, '.paqad/specs', 'resumeable-undefined.yaml'),
        YAML.stringify(
          createManifest({
            slug: 'resumeable-undefined',
            execution_slices: [
              { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
              { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
            ],
          }),
        ),
      );
      writeFileSync(
        join(root, '.paqad/specs', 'resumeable-undefined.execution.json'),
        JSON.stringify({
          slug: 'resumeable-undefined',
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 2,
          status: 'in-progress',
          slices: {
            'SL-1': { status: 'completed' },
            'SL-2': { status: 'pending' },
          },
          token_budget: {
            total: 20_000,
            per_slice_base: 10_000,
            per_slice_with_buffer: 13_000,
            consumed: 0,
            remaining: 20_000,
          },
        }),
      );
      const resumedUndefined = await new SliceExecutor().prepare(root, 'resumeable-undefined');
      expect(resumedUndefined.currentSliceId).toBe('SL-2');
      expect(
        readFileSync(join(root, '.paqad/specs/resumeable-undefined.execution.json'), 'utf8'),
      ).toContain('"attempt": 1');
      expect(resumedUndefined.context?.token_budget).toBe(13000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects execution manifest slugs from preference and filesystem state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-slugs-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      writeFileSync(
        join(root, '.paqad/specs/one.yaml'),
        YAML.stringify(createManifest({ slug: 'one' })),
      );
      expect(await detectExecutionManifestSlug(root, 'preferred')).toBe('preferred');
      expect(await detectExecutionManifestSlug(root)).toBe('one');

      writeFileSync(
        join(root, '.paqad/specs/two.yaml'),
        YAML.stringify(createManifest({ slug: 'two' })),
      );
      expect(await detectExecutionManifestSlug(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('redistributes remaining non-overridden budget based on completion state', () => {
    expect(
      resolveSliceExecutionBudget({
        slice: { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
        slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
        ],
        remainingBudget: 10000,
        currentStatuses: {
          'SL-1': { status: 'completed' },
          'SL-2': { status: 'pending' },
        },
      }),
    ).toBe(13000);

    expect(
      resolveSliceExecutionBudget({
        slice: { ...createManifest().execution_slices[0], slice_id: 'SL-2', token_budget: 7000 },
        slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2', token_budget: 7000 },
        ],
        remainingBudget: 5000,
        currentStatuses: {
          'SL-1': { status: 'completed' },
          'SL-2': { status: 'pending' },
        },
      }),
    ).toBe(7000);

    expect(
      resolveSliceExecutionBudget({
        slice: { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
        slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1', token_budget: 4000 },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
        ],
        remainingBudget: 1000,
        currentStatuses: {
          'SL-1': { status: 'pending' },
          'SL-2': { status: 'pending' },
        },
      }),
    ).toBe(1300);

    expect(
      resolveSliceExecutionBudget({
        slice: { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
        slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-2' }],
        remainingBudget: 1000,
        currentStatuses: {
          'SL-2': { status: 'completed' },
        },
      }),
    ).toBe(0);
  });

  it('falls back to planned slice budgets when completed slices lack recorded token usage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-budget-estimate-fallback-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({
        slug: 'budget-estimate-fallback',
        execution_slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
          { ...createManifest().execution_slices[0], slice_id: 'SL-2' },
          { ...createManifest().execution_slices[0], slice_id: 'SL-3' },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/budget-estimate-fallback.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );
      writeFileSync(
        join(root, '.paqad/specs/budget-estimate-fallback.execution.json'),
        JSON.stringify({
          slug: manifest.slug,
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 2,
          status: 'in-progress',
          slices: {
            'SL-1': { status: 'completed', attempt: 1 },
            'SL-2': { status: 'completed', attempt: 1, tokens_used: 1000 },
            'SL-3': { status: 'pending', attempt: 0 },
          },
          token_budget: {
            total: 15_000,
            per_slice_base: 5_000,
            per_slice_with_buffer: 6_500,
            consumed: 1000,
            remaining: 14_000,
          },
        }),
        'utf8',
      );

      const prepared = await new SliceExecutor().prepare(root, manifest.slug);
      expect(prepared.currentSliceId).toBe('SL-3');
      expect(prepared.context?.token_budget).toBe(9750);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('escalates immediately for protected-file scope violations and records token budget warnings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-protected-scope-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({
        slug: 'protected-scope-manifest',
        execution_slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1', token_budget: 100 },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/protected-scope-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async () => ({
          tokens_used: 90,
          files_changed: ['.paqad/session/handoff.json'],
        }),
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(result.escalatedSliceIds).toEqual(['SL-1']);
      expect(result.blockedSliceIds).toContain('SL-2');
      expect(result.warnings).toContain('SL-1 consumed 90 tokens against budget 100.');
      expect(readFileSync(result.escalationPaths[0]!, 'utf8')).toContain('protected_scope');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records circuit-breaker escalations when the breaker fires before retry exhaustion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-circuit-breaker-'));
    const observe = vi.spyOn(SliceCircuitBreaker.prototype, 'observe').mockReturnValueOnce(true);
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'circuit-breaker-manifest',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs/circuit-breaker-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async ({ context }) => {
          writeFileSync(
            join(root, context.current_slice.touches[0]!),
            'export const broken = true;\n',
          );
          return { tokens_used: 10, files_changed: [context.current_slice.touches[0]!] };
        },
        criteriaRunner: async () => ({ passed: false, detail: 'still broken' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(result.escalatedSliceIds).toEqual(['SL-1']);
      expect(readFileSync(result.escalationPaths[0]!, 'utf8')).toContain('circuit_breaker');
    } finally {
      observe.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes checkpoints with explicit compression stats when the executor returns token metrics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-compression-stats-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'compression-stats-manifest',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs/compression-stats-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async ({ context }) => {
          writeFileSync(join(root, context.current_slice.touches[0]!), 'export const ok = true;\n');
          return {
            tokens_used: 10,
            files_changed: [context.current_slice.touches[0]!],
            raw_context_tokens: 0,
            summary_tokens: 0,
            exports_created: ['ok'],
          };
        },
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      const checkpoint = JSON.parse(readFileSync(result.checkpointPaths[0]!, 'utf8')) as {
        exports_created: string[];
        compression_stats: {
          raw_context_tokens: number;
          summary_tokens: number;
          compression_ratio: number;
        };
      };
      expect(checkpoint.exports_created).toEqual(['ok']);
      expect(checkpoint.compression_stats).toEqual({
        raw_context_tokens: 0,
        summary_tokens: 0,
        compression_ratio: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('continues cleanly when prior completed slices do not have checkpoints to scan for scope warnings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-missing-prior-checkpoint-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'missing-prior-checkpoint',
        execution_slices: [
          { ...createManifest().execution_slices[0], slice_id: 'SL-1' },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
            touches: ['src/planning/second.ts'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/missing-prior-checkpoint.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );
      writeFileSync(
        join(root, '.paqad/specs/missing-prior-checkpoint.execution.json'),
        JSON.stringify({
          slug: manifest.slug,
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 2,
          status: 'in-progress',
          slices: {
            'SL-1': { status: 'completed', attempt: 1, tokens_used: 100 },
            'SL-2': { status: 'pending', attempt: 0 },
          },
          token_budget: {
            total: 1000,
            per_slice_base: 500,
            per_slice_with_buffer: 650,
            consumed: 100,
            remaining: 900,
          },
        }),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async ({ context }) => {
          writeFileSync(
            join(root, context.current_slice.touches[0]!),
            'export const second = true;\n',
          );
          return { tokens_used: 100, files_changed: [context.current_slice.touches[0]!] };
        },
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(result.completedSliceIds).toEqual(['SL-1', 'SL-2']);
      expect(result.warnings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to diff-based file discovery, records no-file retry summaries, and stringifies replan errors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-diff-fallback-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({
        slug: 'diff-fallback-manifest',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs/diff-fallback-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async () => ({ tokens_used: 10 }),
        criteriaRunner: async () => ({ passed: false, detail: 'missing' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
        replan: async () => {
          throw 'string replan failure';
        },
      });

      expect(result.warnings).toContain('string replan failure');
      const escalation = JSON.parse(readFileSync(result.escalationPaths[0]!, 'utf8')) as {
        fix_attempts: Array<{ change_summary: string }>;
      };
      expect(escalation.fix_attempts[0]?.change_summary).toBe('Attempt 1 updated no files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resumes without a next slice when every completed slice has a valid checkpoint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-resume-complete-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({
        slug: 'resume-complete-manifest',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs/resume-complete-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );
      writeFileSync(
        join(root, '.paqad/specs/resume-complete-manifest.execution.json'),
        JSON.stringify({
          slug: manifest.slug,
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 1,
          status: 'completed',
          slices: {
            'SL-1': { status: 'completed', attempt: 1, tokens_used: 100 },
          },
          token_budget: {
            total: 1000,
            per_slice_base: 1000,
            per_slice_with_buffer: 1300,
            consumed: 100,
            remaining: 900,
          },
        }),
        'utf8',
      );
      await new SliceCheckpointStore().save(root, manifest.slug, {
        slice_id: 'SL-1',
        goal: 'done',
        status: 'completed',
        attempt: 1,
        started_at: '2026-04-10T00:00:00.000Z',
        completed_at: '2026-04-10T00:01:00.000Z',
        tokens_used: 100,
        files_changed: ['src/planning/index.ts'],
        exports_created: [],
        decisions_made: [],
        criteria_results: {},
        doc_targets_updated: [],
        regression_results: {},
        gate_result: {
          status: 'pass',
          criteria: { total: 0, covered: 0, uncovered: 0 },
          scope: { status: 'clean', modified_files: [], violations: [] },
          docs: { total: 0, updated: 0, skipped: 0 },
          regression: { total: 0, passing: 0, failing: 0 },
          full_suite: {
            total_tests: 0,
            passing: 0,
            failing: 0,
            new_failures: [],
            pre_existing_failures: [],
            duration_ms: 1,
            slow_suite_warning: false,
          },
          warnings: [],
        },
        compression_stats: {
          raw_context_tokens: 100,
          summary_tokens: 10,
          compression_ratio: 0.1,
        },
      });

      const resumed = await new SliceExecutor().resume(root, manifest.slug);
      expect(resumed.resetSliceIds).toEqual([]);
      expect(resumed.currentSliceId).toBeNull();
      expect(resumed.warnings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the in-memory tracker and default attempt when the tracker reload disappears mid-execution', async () => {
    class FlakyTracker extends ExecutionTracker {
      private loadCalls = 0;

      override async load(projectRoot: string, slug: string) {
        this.loadCalls += 1;
        if (this.loadCalls === 3) {
          return null;
        }
        return super.load(projectRoot, slug);
      }
    }

    const root = mkdtempSync(join(tmpdir(), 'slice-flaky-tracker-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'flaky-tracker-manifest',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs/flaky-tracker-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );
      writeFileSync(
        join(root, '.paqad/specs/flaky-tracker-manifest.execution.json'),
        JSON.stringify({
          slug: manifest.slug,
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 1,
          status: 'not-started',
          slices: {
            'SL-1': {
              status: 'pending',
              started_at: null,
              completed_at: null,
              tokens_used: null,
              tests_passed: null,
              tests_failed: null,
              docs_updated: null,
              scope_clean: null,
            },
          },
          token_budget: {
            total: 1000,
            per_slice_base: 1000,
            per_slice_with_buffer: 1300,
            consumed: 0,
            remaining: 1000,
          },
        }),
        'utf8',
      );

      const attempts: number[] = [];
      const result = await new SliceExecutor(new FlakyTracker()).execute(root, manifest.slug, {
        executeSlice: async ({ attempt, context }) => {
          attempts.push(attempt);
          writeFileSync(join(root, context.current_slice.touches[0]!), 'export const ok = true;\n');
          return { tokens_used: 10, files_changed: [context.current_slice.touches[0]!] };
        },
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(attempts).toEqual([1]);
      expect(result.completedSliceIds).toEqual(['SL-1']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tracks repeated failure signatures with the slice circuit breaker', async () => {
    const breaker = new SliceCircuitBreaker();
    const feedback = buildSliceRetryFeedback({
      gate_result: {
        status: 'fail',
        criteria: { total: 1, covered: 0, uncovered: 1 },
        scope: { status: 'clean', modified_files: [], violations: [] },
        docs: { total: 0, updated: 0, skipped: 0 },
        regression: { total: 0, passing: 0, failing: 0 },
        full_suite: {
          total_tests: 1,
          passing: 1,
          failing: 0,
          new_failures: [],
          pre_existing_failures: [],
          duration_ms: 1,
          slow_suite_warning: false,
        },
        warnings: [],
      },
      criteria_checks: [
        {
          criterion_id: 'AC-1',
          status: 'uncovered',
          passed: false,
          detail: 'still failing',
          proof_target: 'tests/unit/planning/generated.test.ts',
        },
      ],
      doc_checks: [],
      regression_checks: [],
      scope_check: { status: 'clean', modified_files: [], violations: [] },
      full_suite_check: {
        total_tests: 1,
        passing: 1,
        failing: 0,
        new_failures: [],
        pre_existing_failures: [],
        duration_ms: 1,
        slow_suite_warning: false,
      },
    });

    const gate = {
      gate_result: {
        status: 'fail' as const,
        criteria: { total: 1, covered: 0, uncovered: 1 },
        scope: { status: 'clean' as const, modified_files: [], violations: [] },
        docs: { total: 0, updated: 0, skipped: 0 },
        regression: { total: 0, passing: 0, failing: 0 },
        full_suite: {
          total_tests: 1,
          passing: 1,
          failing: 0,
          new_failures: [],
          pre_existing_failures: [],
          duration_ms: 1,
          slow_suite_warning: false,
        },
        warnings: [],
      },
      criteria_checks: [
        {
          criterion_id: feedback.failing_criteria[0]!,
          status: 'uncovered' as const,
          passed: false,
          detail: 'still failing',
          proof_target: 'tests/unit/planning/generated.test.ts',
        },
      ],
      doc_checks: [],
      regression_checks: [],
      scope_check: { status: 'clean' as const, modified_files: [], violations: [] },
      full_suite_check: {
        total_tests: 1,
        passing: 1,
        failing: 0,
        new_failures: [],
        pre_existing_failures: [],
        duration_ms: 1,
        slow_suite_warning: false,
      },
    };

    expect(breaker.observe(gate)).toBe(false);
    expect(breaker.observe(gate)).toBe(false);
    expect(breaker.observe(gate)).toBe(true);
    breaker.reset();
    expect(breaker.observe({ ...gate, criteria_checks: [] })).toBe(false);
  });

  it('writes escalation reports, supports replanning, executes retries, and resumes corrupted checkpoints', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-execution-runtime-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'runtime-manifest',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
            goal: 'first slice',
            touches: ['src/planning/one.ts'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            goal: 'second slice',
            depends_on: ['SL-1'],
            touches: ['src/planning/two.ts'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-3',
            goal: 'independent slice',
            depends_on: [],
            touches: ['src/planning/three.ts'],
          },
        ],
        doc_targets: [
          {
            target_id: 'DOC-1',
            file: 'docs/modules/planning/technical.md',
            section: 'Overview',
            reason: 'Document slice',
            slice_id: 'SL-1',
            status: 'pending',
          },
        ],
        regression_watch: [
          {
            entry_id: 'REG-1',
            test_file: 'tests/unit/planning/generated.test.ts',
            touched_file: 'src/planning/one.ts',
            slice_id: 'SL-1',
            status: 'pending',
          },
        ],
      });
      mkdirSync(join(root, 'docs/modules/planning'), { recursive: true });
      writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'before\n');
      writeFileSync(join(root, '.paqad/specs', 'runtime-manifest.yaml'), YAML.stringify(manifest));
      let runtimeManifest = manifest;
      let currentSliceId: string | null = null;

      const attempts: Record<string, number> = {};
      const executor = new SliceExecutor();
      const result = await executor.execute(root, 'runtime-manifest', {
        executeSlice: async ({ context, attempt, retry_feedback }) => {
          currentSliceId = context.current_slice.slice_id;
          attempts[context.current_slice.slice_id] = attempt;
          const target = join(root, context.current_slice.touches[0]!);
          writeFileSync(
            target,
            `export const ${context.current_slice.slice_id.replace('-', '_')} = ${attempt};\n`,
            'utf8',
          );
          if (context.current_slice.slice_id === 'SL-1') {
            writeFileSync(join(root, 'docs/modules/planning/technical.md'), `updated ${attempt}\n`);
          }
          return {
            tokens_used: 900 + attempt,
            files_changed: [context.current_slice.touches[0]!],
            exports_created: [
              `${context.current_slice.slice_id.replace('-', '_')} (${context.current_slice.touches[0]})`,
            ],
            change_summary: retry_feedback ? 'retry applied' : 'initial change',
          };
        },
        criteriaRunner: async (proofTarget) => ({
          passed:
            currentSliceId !== 'SL-2' ||
            !proofTarget.includes('generated') ||
            (attempts['SL-2'] ?? 0) > 1 ||
            runtimeManifest.execution_slices.find((slice) => slice.slice_id === 'SL-2')?.touches
              .length === 2,
          detail: proofTarget,
        }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 2,
          passing:
            currentSliceId !== 'SL-2' ||
            runtimeManifest.execution_slices.find((slice) => slice.slice_id === 'SL-2')?.touches
              .length === 2
              ? 2
              : attempts['SL-2']
                ? 1
                : 2,
          failing:
            currentSliceId !== 'SL-2' ||
            runtimeManifest.execution_slices.find((slice) => slice.slice_id === 'SL-2')?.touches
              .length === 2
              ? 0
              : attempts['SL-2']
                ? 1
                : 0,
          failing_tests:
            currentSliceId !== 'SL-2' ||
            runtimeManifest.execution_slices.find((slice) => slice.slice_id === 'SL-2')?.touches
              .length === 2
              ? []
              : attempts['SL-2']
                ? ['suite failure']
                : [],
          duration_ms: 10,
        }),
        captureBaselineFailingTests: async () => ['known failure'],
        replan: async ({ manifest: current, report }) => {
          if (report.slice_id !== 'SL-2') {
            return null;
          }
          runtimeManifest = {
            ...current,
            execution_slices: current.execution_slices.map((slice) =>
              slice.slice_id === 'SL-2'
                ? { ...slice, touches: ['src/planning/two.ts', 'src/planning/two-helper.ts'] }
                : slice,
            ),
            verification_matrix: [
              ...current.verification_matrix,
              {
                ...current.verification_matrix[0],
                criterion_id: 'AC-2',
                proof_target: 'tests/unit/planning/generated-replan.test.ts',
                status: 'uncovered',
              },
            ],
          };
          return runtimeManifest;
        },
      });

      expect(result.completedSliceIds).toContain('SL-1');
      expect(result.completedSliceIds).toContain('SL-2');
      expect(result.escalationPaths).toHaveLength(1);
      expect(readFileSync(result.escalationPaths[0]!, 'utf8')).toContain('"slice_id": "SL-2"');
      expect(readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toContain('slice-retried');
      expect(readFileSync(join(root, '.paqad/specs/runtime-manifest.yaml'), 'utf8')).toContain(
        'src/planning/two-helper.ts',
      );
      expect(result.warnings.some((warning) => warning.includes('Generated skeleton'))).toBe(true);

      writeFileSync(join(root, '.paqad/specs/runtime-manifest.checkpoints/SL-1.json'), '{', 'utf8');
      const resumed = await executor.resume(root, 'runtime-manifest');
      expect(resumed.resetSliceIds).toContain('SL-1');
      expect(resumed.warnings[0]).toContain('missing or corrupt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records replan failures and resets non-completed slices during resume', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-replan-failure-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'replan-failure-manifest',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
            touches: ['src/planning/one.ts'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
            touches: ['src/planning/two.ts'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/replan-failure-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const executeResult = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async ({ context }) => {
          writeFileSync(join(root, context.current_slice.touches[0]!), 'export const value = 1;\n');
          return { tokens_used: 100, files_changed: [context.current_slice.touches[0]!] };
        },
        criteriaRunner: async () => ({ passed: false, detail: 'missing' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
        replan: async () => {
          throw new Error('replan exploded');
        },
      });

      expect(executeResult.escalatedSliceIds).toContain('SL-1');
      expect(executeResult.warnings).toContain('replan exploded');
      expect(readFileSync(join(root, '.paqad/audit.log'), 'utf8')).toContain('slice-replan-failed');

      writeFileSync(
        join(root, '.paqad/specs/replan-failure-manifest.execution.json'),
        JSON.stringify({
          slug: manifest.slug,
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 2,
          status: 'failed',
          slices: {
            'SL-1': { status: 'failed', attempt: 2 },
            'SL-2': { status: 'blocked', attempt: 0 },
          },
          token_budget: {
            total: 1000,
            per_slice_base: 500,
            per_slice_with_buffer: 650,
            consumed: 0,
            remaining: 1000,
          },
        }),
        'utf8',
      );

      const resumed = await new SliceExecutor().resume(root, manifest.slug);
      expect(resumed.resetSliceIds).toEqual(['SL-1', 'SL-2']);
      const tracker = JSON.parse(
        readFileSync(join(root, '.paqad/specs/replan-failure-manifest.execution.json'), 'utf8'),
      ) as {
        slices: Record<string, { status: string }>;
      };
      expect(tracker.slices['SL-1'].status).toBe('in-progress');
      expect(tracker.slices['SL-2'].status).toBe('pending');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes audit entries, persists escalation reports, and loads null for missing or corrupt reports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-audit-escalation-'));
    try {
      appendPlanningAudit(root, 'INFO', 'slice-note');
      appendPlanningAudit(root, 'WARN', 'slice-note', {
        detail: 'line 1\nline 2',
        quoted: '"value"',
      });
      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('INFO slice-note');
      expect(audit).toContain(`detail="line 1 line 2"`);
      expect(audit).toContain(`quoted="'value'"`);

      const store = new SliceEscalationStore();
      const report = createSliceEscalationReport({
        sliceId: 'SL-1',
        reason: 'retry_failed',
        attempts: 2,
        gate: {
          gate_result: {
            status: 'fail',
            criteria: { total: 1, covered: 0, uncovered: 1 },
            scope: { status: 'clean', modified_files: [], violations: [] },
            docs: { total: 0, updated: 0, skipped: 0 },
            regression: { total: 0, passing: 0, failing: 0 },
            full_suite: {
              total_tests: 1,
              passing: 0,
              failing: 1,
              new_failures: ['suite failure'],
              pre_existing_failures: [],
              duration_ms: 1,
              slow_suite_warning: false,
            },
            warnings: [],
          },
          criteria_checks: [
            {
              criterion_id: 'AC-1',
              status: 'uncovered',
              passed: false,
              detail: 'failed',
              proof_target: undefined,
            },
          ],
          doc_checks: [],
          regression_checks: [],
          scope_check: { status: 'clean', modified_files: [], violations: [] },
          full_suite_check: {
            total_tests: 1,
            passing: 0,
            failing: 1,
            new_failures: ['suite failure'],
            pre_existing_failures: [],
            duration_ms: 1,
            slow_suite_warning: false,
          },
        },
        fixAttempts: [],
        tokensConsumed: 10,
        recommendation: 'retry',
        blockedDownstream: [],
      });

      const target = await store.save(root, 'audit-escalation', report);
      expect(await store.load(root, 'audit-escalation', 'SL-1')).toEqual(report);
      expect(await store.load(root, 'audit-escalation', 'missing')).toBeNull();
      writeFileSync(target, '{', 'utf8');
      expect(await store.load(root, 'audit-escalation', 'SL-1')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null when no replanner is provided or when replanning declines changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-replan-null-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({ slug: 'replan-null-manifest' });
      const report = createSliceEscalationReport({
        sliceId: 'SL-1',
        reason: 'retry_failed',
        attempts: 2,
        gate: {
          gate_result: {
            status: 'fail',
            criteria: { total: 1, covered: 0, uncovered: 1 },
            scope: { status: 'clean', modified_files: [], violations: [] },
            docs: { total: 0, updated: 0, skipped: 0 },
            regression: { total: 0, passing: 0, failing: 0 },
            full_suite: {
              total_tests: 1,
              passing: 1,
              failing: 0,
              new_failures: [],
              pre_existing_failures: [],
              duration_ms: 1,
              slow_suite_warning: false,
            },
            warnings: [],
          },
          criteria_checks: [],
          doc_checks: [],
          regression_checks: [],
          scope_check: { status: 'clean', modified_files: [], violations: [] },
          full_suite_check: {
            total_tests: 1,
            passing: 1,
            failing: 0,
            new_failures: [],
            pre_existing_failures: [],
            duration_ms: 1,
            slow_suite_warning: false,
          },
        },
        fixAttempts: [],
        tokensConsumed: 1,
        recommendation: 'noop',
        blockedDownstream: [],
      });

      await expect(
        attemptEscalationReplan({
          projectRoot: root,
          manifest,
          report,
        }),
      ).resolves.toBeNull();
      await expect(
        attemptEscalationReplan({
          projectRoot: root,
          manifest,
          report,
          replan: async () => null,
        }),
      ).resolves.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('covers fast-lane execution pass, retry failure, and immediate escalation paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-fast-lane-execute-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, 'docs/modules/planning'), { recursive: true });
      writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'before\n', 'utf8');

      const writeManifest = (slug: string, lane: 'fast' | 'graduated') => {
        const manifest = createManifest({
          slug,
          classification: { ...createManifest().classification, lane },
          execution_slices: lane === 'fast' ? [] : createManifest().execution_slices,
          doc_targets: [
            {
              target_id: 'DOC-1',
              file: 'docs/modules/planning/technical.md',
              section: 'Overview',
              reason: 'Document slice',
              slice_id: 'SL-1',
              status: 'pending',
            },
          ],
          regression_watch: [
            {
              entry_id: 'REG-1',
              test_file: 'tests/unit/planning/generated.test.ts',
              touched_file: 'src/planning/index.ts',
              slice_id: 'SL-1',
              status: 'pending',
            },
          ],
        });
        writeFileSync(join(root, '.paqad/specs', `${slug}.yaml`), YAML.stringify(manifest), 'utf8');
        return manifest;
      };

      writeManifest('fast-pass', 'fast');
      const fastPass = await new SliceExecutor().execute(root, 'fast-pass', {
        executeSlice: async ({ context }) => {
          writeFileSync(join(root, 'src/planning/index.ts'), 'export const ok = true;\n', 'utf8');
          writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'updated\n', 'utf8');
          expect(context.test_skeletons).toEqual(['tests/unit/planning/generated.test.ts']);
          return { tokens_used: 14_000 };
        },
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
        captureBaselineFailingTests: async () => ['known failure'],
      });
      expect(fastPass.trackerStatus).toBe('completed');
      expect(fastPass.completedSliceIds).toEqual(['SL-1']);
      expect(fastPass.warnings[0]).toContain('consumed 14000');

      writeManifest('fast-retry', 'fast');
      let retryAttemptCount = 0;
      const fastRetry = await new SliceExecutor().execute(root, 'fast-retry', {
        executeSlice: async ({ attempt, retry_feedback }) => {
          retryAttemptCount = attempt;
          expect(attempt === 1 ? retry_feedback : retry_feedback?.failing_criteria).toEqual(
            attempt === 1 ? undefined : ['AC-1'],
          );
          writeFileSync(
            join(root, 'src/planning/index.ts'),
            `export const attempt = ${attempt};\n`,
          );
          return { tokens_used: 100 };
        },
        criteriaRunner: async () => ({ passed: false, detail: 'missing' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });
      expect(retryAttemptCount).toBe(2);
      expect(fastRetry.trackerStatus).toBe('failed');
      expect(fastRetry.warnings).toContain('Fast-lane retry failed for fast-retry.');

      writeManifest('fast-retry-success', 'fast');
      let retrySuccessAttempt = 0;
      const fastRetrySuccess = await new SliceExecutor().execute(root, 'fast-retry-success', {
        executeSlice: async ({ attempt }) => {
          retrySuccessAttempt = attempt;
          writeFileSync(
            join(root, 'src/planning/index.ts'),
            `export const attempt = ${attempt};\n`,
            'utf8',
          );
          return { tokens_used: 100 };
        },
        criteriaRunner: async () => ({ passed: retrySuccessAttempt > 1, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });
      expect(fastRetrySuccess.trackerStatus).toBe('completed');
      expect(fastRetrySuccess.completedSliceIds).toEqual(['SL-1']);

      writeManifest('fast-escalated', 'fast');
      const fastEscalated = await new SliceExecutor().execute(root, 'fast-escalated', {
        executeSlice: async () => {
          return { tokens_used: 100, files_changed: ['.paqad/session/handoff.json'] };
        },
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });
      expect(fastEscalated.trackerStatus).toBe('failed');
      expect(fastEscalated.completedSliceIds).toEqual([]);
      expect(fastEscalated.warnings).toContain(
        'Fast-lane execution escalated immediately for fast-escalated.',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the abbreviated decision screen for fast-lane forks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-fast-lane-decision-'));
    try {
      mockPromptForDecision.mockResolvedValue({
        chosen_option_key: 'keep-current-path',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      });

      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const ok = true;\n', 'utf8');
      writeFileSync(
        join(root, PATHS.PROJECT_PROFILE),
        YAML.stringify(makeDecisionProfile('permissive')),
        'utf8',
      );

      const manifest = createManifest({
        slug: 'fast-decision',
        classification: { ...createManifest().classification, lane: 'fast' },
        execution_slices: [],
        requirement_graph: [
          {
            ...createManifest().requirement_graph[0]!,
            id: 'FR-1',
            description: 'Either keep the current path or take a new path.',
            scope: ['src/planning/index.ts'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/fast-decision.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, 'fast-decision', {
        executeSlice: async () => ({ tokens_used: 100 }),
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(result.trackerStatus).toBe('completed');
      expect(mockPromptForDecision).toHaveBeenCalledWith(
        expect.objectContaining({ decision_id: 'D-2' }),
        { mode: 'fast' },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips the fast-lane screen when only one valid path remains', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-fast-lane-single-path-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const ok = true;\n', 'utf8');

      const manifest = createManifest({
        slug: 'fast-single-path',
        classification: { ...createManifest().classification, lane: 'fast' },
        execution_slices: [],
        requirement_graph: [
          {
            ...createManifest().requirement_graph[0]!,
            id: 'FR-1',
            description: 'Either keep the current path or take a new path.',
            scope: ['src/planning/index.ts'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/fast-single-path.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, 'fast-single-path', {
        executeSlice: async () => ({ tokens_used: 100 }),
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(result.trackerStatus).toBe('completed');
      expect(mockPromptForDecision).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('auto-resolves fast-lane forks when confidence already clears the ask threshold', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-fast-lane-auto-resolve-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const ok = true;\n', 'utf8');

      const manifest = createManifest({
        slug: 'fast-auto-resolve',
        classification: { ...createManifest().classification, lane: 'fast' },
        execution_slices: [],
        requirement_graph: [
          {
            ...createManifest().requirement_graph[0]!,
            id: 'FR-1',
            description: 'Should we reuse existing code or create new support?',
            scope: ['src/planning/index.ts'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/fast-auto-resolve.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, 'fast-auto-resolve', {
        executeSlice: async () => ({ tokens_used: 100 }),
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(result.trackerStatus).toBe('completed');
      expect(mockPromptForDecision).not.toHaveBeenCalled();
      const saved = YAML.parse(
        readFileSync(join(root, '.paqad/specs/fast-auto-resolve.yaml'), 'utf8'),
      ) as { decision_log: Array<{ decision_id: string }> };
      expect(saved.decision_log.some((entry) => entry.decision_id === 'D-2')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records cumulative token usage across retries for completed and escalated slices', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-retry-token-usage-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });

      const completedManifest = createManifest({
        slug: 'retry-complete-manifest',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs/retry-complete-manifest.yaml'),
        YAML.stringify(completedManifest),
        'utf8',
      );

      let completeAttempt = 0;
      await new SliceExecutor().execute(root, completedManifest.slug, {
        executeSlice: async ({ attempt, context }) => {
          completeAttempt = attempt;
          writeFileSync(
            join(root, context.current_slice.touches[0]!),
            `attempt ${attempt}\n`,
            'utf8',
          );
          return {
            tokens_used: attempt === 1 ? 100 : 50,
            files_changed: [context.current_slice.touches[0]!],
          };
        },
        criteriaRunner: async () => ({ passed: completeAttempt > 1, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });
      const completedTracker = JSON.parse(
        readFileSync(join(root, '.paqad/specs/retry-complete-manifest.execution.json'), 'utf8'),
      ) as { slices: Record<string, { tokens_used: number }> };
      expect(completedTracker.slices['SL-1'].tokens_used).toBe(150);
      const completedCheckpoint = JSON.parse(
        readFileSync(
          join(root, '.paqad/specs/retry-complete-manifest.checkpoints/SL-1.json'),
          'utf8',
        ),
      ) as { tokens_used: number };
      expect(completedCheckpoint.tokens_used).toBe(150);

      const escalatedManifest = createManifest({
        slug: 'retry-escalate-manifest',
        execution_slices: [{ ...createManifest().execution_slices[0], slice_id: 'SL-1' }],
      });
      writeFileSync(
        join(root, '.paqad/specs/retry-escalate-manifest.yaml'),
        YAML.stringify(escalatedManifest),
        'utf8',
      );

      await new SliceExecutor().execute(root, escalatedManifest.slug, {
        executeSlice: async ({ attempt, context }) => {
          writeFileSync(
            join(root, context.current_slice.touches[0]!),
            `attempt ${attempt}\n`,
            'utf8',
          );
          return {
            tokens_used: attempt === 1 ? 80 : 20,
            files_changed: [context.current_slice.touches[0]!],
          };
        },
        criteriaRunner: async () => ({ passed: false, detail: 'still failing' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });
      const escalatedTracker = JSON.parse(
        readFileSync(join(root, '.paqad/specs/retry-escalate-manifest.execution.json'), 'utf8'),
      ) as { slices: Record<string, { tokens_used: number }> };
      expect(escalatedTracker.slices['SL-1'].tokens_used).toBe(100);
      const escalatedCheckpoint = JSON.parse(
        readFileSync(
          join(root, '.paqad/specs/retry-escalate-manifest.checkpoints/SL-1.json'),
          'utf8',
        ),
      ) as { tokens_used: number; status: string };
      expect(escalatedCheckpoint.tokens_used).toBe(100);
      expect(escalatedCheckpoint.status).toBe('escalated');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reuses prior-slice scope violations when gating later slices', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-prior-scope-warning-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      const manifest = createManifest({
        slug: 'prior-scope-manifest',
        execution_slices: [
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-1',
            touches: ['src/planning/shared.ts'],
          },
          {
            ...createManifest().execution_slices[0],
            slice_id: 'SL-2',
            depends_on: ['SL-1'],
            touches: ['src/planning/second.ts'],
          },
        ],
      });
      writeFileSync(
        join(root, '.paqad/specs/prior-scope-manifest.yaml'),
        YAML.stringify(manifest),
        'utf8',
      );
      const checkpoints = new SliceCheckpointStore();
      await checkpoints.save(root, manifest.slug, {
        slice_id: 'SL-1',
        goal: 'first',
        status: 'completed',
        attempt: 1,
        started_at: '2026-04-10T00:00:00.000Z',
        completed_at: '2026-04-10T00:01:00.000Z',
        tokens_used: 100,
        files_changed: ['src/planning/shared.ts'],
        exports_created: [],
        decisions_made: [],
        criteria_results: {},
        doc_targets_updated: [],
        regression_results: {},
        gate_result: {
          status: 'pass',
          criteria: { total: 0, covered: 0, uncovered: 0 },
          scope: {
            status: 'violation',
            modified_files: ['src/planning/shared.ts'],
            violations: [
              {
                file: 'src/planning/shared.ts',
                type: 'prior-slice',
                slice_id: 'SL-1',
                owner_slice_id: 'SL-1',
                message: 'warning',
              },
            ],
          },
          docs: { total: 0, updated: 0, skipped: 0 },
          regression: { total: 0, passing: 0, failing: 0 },
          full_suite: {
            total_tests: 0,
            passing: 0,
            failing: 0,
            new_failures: [],
            pre_existing_failures: [],
            duration_ms: 1,
            slow_suite_warning: false,
          },
          warnings: [],
        },
        compression_stats: {
          raw_context_tokens: 100,
          summary_tokens: 10,
          compression_ratio: 0.1,
        },
      });
      writeFileSync(
        join(root, '.paqad/specs/prior-scope-manifest.execution.json'),
        JSON.stringify({
          slug: manifest.slug,
          started_at: '2026-04-10T00:00:00.000Z',
          updated_at: '2026-04-10T00:00:00.000Z',
          total_slices: 2,
          status: 'in-progress',
          slices: {
            'SL-1': { status: 'completed', attempt: 1, tokens_used: 100 },
            'SL-2': { status: 'pending', attempt: 0 },
          },
          token_budget: {
            total: 1000,
            per_slice_base: 500,
            per_slice_with_buffer: 650,
            consumed: 100,
            remaining: 900,
          },
        }),
        'utf8',
      );

      const result = await new SliceExecutor().execute(root, manifest.slug, {
        executeSlice: async () => {
          writeFileSync(
            join(root, 'src/planning/shared.ts'),
            'export const touchedAgain = true;\n',
          );
          return { tokens_used: 100, files_changed: ['src/planning/shared.ts'] };
        },
        criteriaRunner: async () => ({ passed: true, detail: 'ok' }),
        regressionRunner: async () => ({ passed: true, detail: 'ok' }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 1,
        }),
      });

      expect(result.escalatedSliceIds).toEqual(['SL-2']);
      expect(readFileSync(result.escalationPaths[0]!, 'utf8')).toContain('retry_failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates escalation reports and accepts validated replans', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-replan-'));
    try {
      mkdirSync(join(root, '.paqad/specs'), { recursive: true });
      const manifest = createManifest({ slug: 'replan-manifest' });
      const report = createSliceEscalationReport({
        sliceId: 'SL-1',
        reason: 'retry_failed',
        attempts: 2,
        gate: {
          gate_result: {
            status: 'fail',
            criteria: { total: 1, covered: 0, uncovered: 1 },
            scope: { status: 'clean', modified_files: [], violations: [] },
            docs: { total: 0, updated: 0, skipped: 0 },
            regression: { total: 0, passing: 0, failing: 0 },
            full_suite: {
              total_tests: 1,
              passing: 1,
              failing: 0,
              new_failures: [],
              pre_existing_failures: [],
              duration_ms: 1,
              slow_suite_warning: false,
            },
            warnings: [],
          },
          criteria_checks: [
            {
              criterion_id: 'AC-1',
              status: 'uncovered',
              passed: false,
              detail: 'broken',
              proof_target: 'tests/unit/planning/generated.test.ts',
            },
          ],
          doc_checks: [],
          regression_checks: [],
          scope_check: { status: 'clean', modified_files: [], violations: [] },
          full_suite_check: {
            total_tests: 1,
            passing: 1,
            failing: 0,
            new_failures: [],
            pre_existing_failures: [],
            duration_ms: 1,
            slow_suite_warning: false,
          },
        },
        fixAttempts: [{ attempt: 1, change_summary: 'changed code', result: 'still broken' }],
        tokensConsumed: 200,
        recommendation: 'revisit plan',
        blockedDownstream: ['SL-2'],
      });

      const replanned = await attemptEscalationReplan({
        projectRoot: root,
        manifest,
        report,
        replan: async ({ manifest: current }) => ({
          ...current,
          execution_slices: [
            { ...current.execution_slices[0], slice_id: 'SL-1a', depends_on: [] },
            { ...current.execution_slices[0], slice_id: 'SL-2', depends_on: ['SL-1a'] },
          ],
        }),
      });

      expect(replanned?.manifest.execution_slices[0]?.slice_id).toBe('SL-1a');
      await expect(
        attemptEscalationReplan({
          projectRoot: root,
          manifest,
          report,
          replan: async () => ({
            ...manifest,
            execution_slices: [{ ...manifest.execution_slices[0], slice_id: 'bad' }],
          }),
        }),
      ).rejects.toThrow(/Re-planned manifest is invalid/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function makeDecisionProfile(askThreshold: 'strict' | 'balanced' | 'permissive') {
  return {
    project: { name: 'Test', id: 'test', description: 'test' },
    active_capabilities: ['coding'],
    stack_profile: {
      frameworks: ['node'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'pnpm migrate',
      build: 'pnpm build',
    },
    strictness: {
      full_lane_default: true,
      require_adversarial_review: false,
      block_on_stale_docs: false,
      require_db_review_for_migrations: false,
    },
    compliance_packs: [],
    features: {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: false,
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5.4',
      reasoning_model: 'gpt-5.4',
      fast_model: 'gpt-5.4-mini',
    },
    research: { depth: 'standard' },
    intelligence: {
      rag_enabled: true,
      rag_similarity_threshold: 0.8,
      rag_top_n: 5,
    },
    efficiency: {},
    escalation: {
      destructive_operations: 'warn',
      risky_migrations: 'warn',
      security_findings: 'warn',
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
      decisions: { ask_threshold: askThreshold },
    },
  };
}
