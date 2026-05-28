import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  diffSnapshotFiles,
  runSliceGate,
  snapshotDocTargets,
  snapshotSliceScope,
  verifyFullSuite,
  verifyScopedCriteria,
  verifySliceDocs,
  verifySliceRegression,
  verifySliceScope,
} from '@/planning/index.js';

import { createManifest } from './fixtures.js';

describe('slice verification helpers', () => {
  it('verifies automated and non-automated criteria outcomes', async () => {
    const criteria = [
      createManifest().verification_matrix[0],
      {
        ...createManifest().verification_matrix[0],
        criterion_id: 'AC-2',
        proof_type: 'manual',
        proof_target: undefined,
        status: 'covered',
      },
      {
        ...createManifest().verification_matrix[0],
        criterion_id: 'AC-3',
        proof_target: 'tests/unit/planning/failing.test.ts',
      },
    ];

    const checks = await verifyScopedCriteria(criteria, async (proofTarget) => ({
      passed: !proofTarget.includes('failing'),
      detail: proofTarget,
    }));

    expect(checks).toEqual([
      expect.objectContaining({ criterion_id: 'AC-1', status: 'covered', passed: true }),
      expect.objectContaining({ criterion_id: 'AC-2', status: 'covered', passed: true }),
      expect.objectContaining({ criterion_id: 'AC-3', status: 'uncovered', passed: false }),
    ]);
  });

  it('snapshots and verifies doc target changes including missing files', () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-docs-'));
    try {
      mkdirSync(join(root, 'docs/modules/planning'), { recursive: true });
      writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'before\n');

      const docTargets = [
        {
          target_id: 'DOC-1',
          file: 'docs/modules/planning/technical.md',
          section: 'Overview',
          reason: 'docs',
          slice_id: 'SL-1',
          status: 'pending' as const,
        },
        {
          target_id: 'DOC-2',
          file: 'docs/modules/planning/missing.md',
          section: 'Missing',
          reason: 'missing',
          slice_id: 'SL-1',
          status: 'pending' as const,
        },
      ];

      const snapshot = snapshotDocTargets(root, docTargets);
      writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'after\n');

      expect(verifySliceDocs(root, docTargets, snapshot)).toEqual([
        { target_id: 'DOC-1', status: 'updated', changed: true },
        { target_id: 'DOC-2', status: 'skipped', changed: false },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('verifies slice regression entries', async () => {
    const entries = [
      {
        entry_id: 'REG-1',
        test_file: 'tests/unit/a.test.ts',
        touched_file: 'src/a.ts',
        slice_id: 'SL-1',
        status: 'pending' as const,
      },
      {
        entry_id: 'REG-2',
        test_file: 'tests/unit/b.test.ts',
        touched_file: 'src/b.ts',
        slice_id: 'SL-1',
        status: 'pending' as const,
      },
    ];

    const checks = await verifySliceRegression(entries, async (entry) => ({
      passed: entry.entry_id === 'REG-1',
      detail: entry.test_file,
    }));

    expect(checks).toEqual([
      expect.objectContaining({ entry_id: 'REG-1', status: 'passing', passed: true }),
      expect.objectContaining({ entry_id: 'REG-2', status: 'failing', passed: false }),
    ]);
  });

  it('verifies full suite results including new failures and slow-suite warnings', async () => {
    const check = await verifyFullSuite(
      async () => ({
        total_tests: 10,
        passing: 8,
        failing: 2,
        failing_tests: ['new failure', 'known failure'],
        duration_ms: 61_000,
      }),
      ['known failure'],
    );

    expect(check).toEqual({
      total_tests: 10,
      passing: 8,
      failing: 2,
      new_failures: ['new failure'],
      pre_existing_failures: ['known failure'],
      duration_ms: 61_000,
      slow_suite_warning: true,
    });
  });

  it('snapshots scope files and classifies clean, warning, and error scope outcomes', () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-scope-'));
    try {
      mkdirSync(join(root, 'src/planning'), { recursive: true });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const a = 1;\n');
      const snapshot = snapshotSliceScope(root, [
        'src/planning/index.ts',
        'src/planning/missing.ts',
      ]);
      expect(snapshot['src/planning/index.ts']).toMatch(/[a-f0-9]{64}/);
      expect(snapshot['src/planning/missing.ts']).toBeNull();

      const slices = [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          touches: ['src/current.ts'],
        },
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-2',
          touches: ['src/prior.ts'],
        },
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-3',
          touches: ['src/future.ts'],
        },
      ];

      expect(
        verifySliceScope({
          slice: slices[1],
          allSlices: slices,
          modifiedFiles: ['src/prior.ts'],
        }),
      ).toMatchObject({ status: 'clean', violations: [] });

      expect(
        verifySliceScope({
          slice: slices[1],
          allSlices: slices,
          modifiedFiles: ['src/current.ts', 'src/future.ts'],
          priorWarnings: ['src/current.ts'],
        }),
      ).toMatchObject({
        status: 'violation',
        violations: [
          { file: 'src/current.ts', type: 'prior-slice', severity: 'error' },
          { file: 'src/future.ts', type: 'future-slice', severity: 'warning' },
        ],
      });
      expect(
        verifySliceScope({
          slice: slices[1],
          allSlices: slices,
          modifiedFiles: ['src/current.ts'],
        }),
      ).toMatchObject({
        status: 'warning',
        violations: [{ file: 'src/current.ts', type: 'prior-slice', severity: 'warning' }],
      });

      expect(
        verifySliceScope({
          slice: slices[1],
          allSlices: slices,
          modifiedFiles: ['.paqad/session/handoff.json', 'src/outside.ts'],
        }),
      ).toMatchObject({
        status: 'violation',
        violations: [
          { file: '.paqad/session/handoff.json', type: 'protected-file', severity: 'error' },
          { file: 'src/outside.ts', type: 'outside-manifest', severity: 'error' },
        ],
      });
      expect(
        verifySliceScope({
          slice: { ...slices[1], slice_id: 'SL-99' },
          allSlices: slices,
          modifiedFiles: ['src/current.ts'],
        }),
      ).toMatchObject({
        status: 'clean',
        violations: [],
      });
      writeFileSync(join(root, 'src/planning/index.ts'), 'export const a = 2;\n');
      expect(diffSnapshotFiles(root, snapshot)).toEqual(['src/planning/index.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aggregates gate results for pass, warning, and fail paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-gate-'));
    try {
      mkdirSync(join(root, 'docs/modules/planning'), { recursive: true });
      writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'before\n');

      const orderedSlices = [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          touches: ['src/planning/one.ts'],
        },
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-2',
          touches: ['src/planning/two.ts'],
        },
      ];
      const docTargets = [
        {
          target_id: 'DOC-1',
          file: 'docs/modules/planning/technical.md',
          section: 'Overview',
          reason: 'docs',
          slice_id: 'SL-1',
          status: 'pending' as const,
        },
      ];
      const baseline = snapshotDocTargets(root, docTargets);

      const warningResult = await runSliceGate({
        projectRoot: root,
        slice: orderedSlices[0],
        orderedSlices,
        criteria: [createManifest().verification_matrix[0]],
        docTargets,
        docSnapshot: baseline,
        regressionEntries: [],
        modifiedFiles: ['src/planning/two.ts'],
        criteriaRunner: async () => ({ passed: true }),
        regressionRunner: async () => ({ passed: true }),
        fullSuiteRunner: async () => ({
          total_tests: 4,
          passing: 4,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });

      expect(warningResult.gate_result.status).toBe('pass');
      expect(warningResult.gate_result.warnings).toEqual([
        'doc:DOC-1:skipped',
        'scope:future-slice:src/planning/two.ts',
      ]);

      writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'after\n');
      const passingResult = await runSliceGate({
        projectRoot: root,
        slice: orderedSlices[0],
        orderedSlices,
        criteria: [createManifest().verification_matrix[0]],
        docTargets,
        docSnapshot: baseline,
        regressionEntries: [
          {
            entry_id: 'REG-1',
            test_file: 'tests/unit/planning/generated.test.ts',
            touched_file: 'src/planning/one.ts',
            slice_id: 'SL-1',
            status: 'pending' as const,
          },
        ],
        modifiedFiles: ['src/planning/one.ts'],
        criteriaRunner: async () => ({ passed: true }),
        regressionRunner: async () => ({ passed: true }),
        fullSuiteRunner: async () => ({
          total_tests: 4,
          passing: 4,
          failing: 0,
          failing_tests: [],
          duration_ms: 61_000,
        }),
      });

      expect(passingResult.gate_result.status).toBe('pass');
      expect(passingResult.gate_result.warnings).toEqual(['full-suite:slow']);
      expect(passingResult.gate_result.docs).toEqual({ total: 1, updated: 1, skipped: 0 });

      const failingResult = await runSliceGate({
        projectRoot: root,
        slice: orderedSlices[0],
        orderedSlices,
        criteria: [createManifest().verification_matrix[0]],
        docTargets,
        docSnapshot: baseline,
        regressionEntries: [],
        modifiedFiles: ['src/outside.ts'],
        criteriaRunner: async () => ({ passed: false }),
        regressionRunner: async () => ({ passed: true }),
        fullSuiteRunner: async () => ({
          total_tests: 4,
          passing: 3,
          failing: 1,
          failing_tests: ['new failure'],
          duration_ms: 10,
        }),
      });

      expect(failingResult.gate_result.status).toBe('fail');
      expect(failingResult.gate_result.criteria.uncovered).toBe(1);
      expect(failingResult.gate_result.scope.status).toBe('violation');
      expect(failingResult.gate_result.full_suite.new_failures).toEqual(['new failure']);

      const scopeOnlyFail = await runSliceGate({
        projectRoot: root,
        slice: orderedSlices[0],
        orderedSlices,
        criteria: [],
        docTargets: [],
        docSnapshot: {},
        regressionEntries: [],
        modifiedFiles: ['src/outside.ts'],
        criteriaRunner: async () => ({ passed: true }),
        regressionRunner: async () => ({ passed: true }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
      });
      expect(scopeOnlyFail.gate_result.status).toBe('fail');

      const suiteOnlyFail = await runSliceGate({
        projectRoot: root,
        slice: orderedSlices[0],
        orderedSlices,
        criteria: [],
        docTargets: [],
        docSnapshot: {},
        regressionEntries: [],
        modifiedFiles: [],
        criteriaRunner: async () => ({ passed: true }),
        regressionRunner: async () => ({ passed: true }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 0,
          failing: 1,
          failing_tests: ['fresh failure'],
          duration_ms: 10,
        }),
      });
      expect(suiteOnlyFail.gate_result.status).toBe('fail');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('captures branch cases in the aggregated gate output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-gate-branches-'));
    try {
      const slice = createManifest().execution_slices[0];
      const orderedSlices = [slice];

      const result = await runSliceGate({
        projectRoot: root,
        slice,
        orderedSlices,
        criteria: [],
        docTargets: [],
        docSnapshot: {},
        regressionEntries: [
          {
            entry_id: 'REG-1',
            test_file: 'tests/unit/planning/generated.test.ts',
            touched_file: 'src/planning/index.ts',
            slice_id: 'SL-1',
            status: 'pending' as const,
          },
        ],
        modifiedFiles: [],
        criteriaRunner: async () => ({ passed: true }),
        regressionRunner: async () => ({ passed: false }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 0,
          failing: 1,
          failing_tests: ['known failure'],
          duration_ms: 10,
        }),
        baselineFailingTests: ['known failure'],
      });

      expect(result.gate_result.status).toBe('fail');
      expect(result.gate_result.regression).toEqual({ total: 1, passing: 0, failing: 1 });
      expect(result.gate_result.full_suite.pre_existing_failures).toEqual(['known failure']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces resolved decisions as implementation obligations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-gate-decisions-'));
    try {
      const slice = {
        ...createManifest().execution_slices[0],
        slice_id: 'SL-1',
        touches: ['src/components/Button.tsx', 'src/components/ButtonV2.tsx'],
      };
      const orderedSlices = [slice];
      const decisionPackets = [
        {
          decision_id: 'D-7',
          fingerprint: 'sha256:test',
          category: 'component-reuse' as const,
          question: 'Reuse the component or make new?',
          context: 'A component choice is required.',
          options: [
            {
              option_key: 'reuse-existing',
              label: 'Reuse what exists',
              one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
              trade_off: 'You give up: a blank-slate implementation.',
              evidence: { file: 'src/components/Button.tsx', callers: 3, similarity: 0.9 },
            },
            {
              option_key: 'make-new',
              label: 'Make a new one',
              one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
              trade_off: 'You give up: the shared path that already exists.',
              evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
            },
          ],
          confidence: 0.8,
          requested_by: 'codex-cli',
          task_session_id: 'session-1',
          linked_slice_id: 'SL-1',
          created_at: '2026-04-27T12:00:00Z',
          status: 'resolved' as const,
          human_response: {
            chosen_option_key: 'reuse-existing',
            intent: 'explicit' as const,
            explanation_rounds_used: 0,
            responded_at: '2026-04-27T12:01:00Z',
            responded_by: 'haider',
            carry_over_scope: 'none' as const,
          },
          ttl_until: '2099-12-31T12:00:00Z',
          invalidation_watch: [],
        },
      ];

      const failed = await runSliceGate({
        projectRoot: root,
        slice,
        orderedSlices,
        criteria: [],
        docTargets: [],
        docSnapshot: {},
        regressionEntries: [],
        modifiedFiles: ['src/components/ButtonV2.tsx'],
        criteriaRunner: async () => ({ passed: true }),
        regressionRunner: async () => ({ passed: true }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
        decisionPackets,
      });

      expect(failed.gate_result.status).toBe('fail');
      expect(failed.decision_checks).toEqual([
        {
          decision_id: 'D-7',
          passed: false,
          reason:
            'decision-violation: changed a rejected path instead of src/components/Button.tsx',
        },
      ]);

      const passed = await runSliceGate({
        projectRoot: root,
        slice,
        orderedSlices,
        criteria: [],
        docTargets: [],
        docSnapshot: {},
        regressionEntries: [],
        modifiedFiles: ['src/components/Button.tsx'],
        criteriaRunner: async () => ({ passed: true }),
        regressionRunner: async () => ({ passed: true }),
        fullSuiteRunner: async () => ({
          total_tests: 1,
          passing: 1,
          failing: 0,
          failing_tests: [],
          duration_ms: 10,
        }),
        decisionPackets,
      });

      expect(passed.gate_result.status).toBe('pass');
      expect(passed.decision_checks).toEqual([
        {
          decision_id: 'D-7',
          passed: true,
          reason: 'Chosen path src/components/Button.tsx was used.',
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps helper snapshots deterministic for inspection', () => {
    const root = mkdtempSync(join(tmpdir(), 'slice-snapshot-'));
    try {
      mkdirSync(join(root, 'docs/modules/planning'), { recursive: true });
      writeFileSync(join(root, 'docs/modules/planning/technical.md'), 'body\n');
      const snapshot = snapshotDocTargets(root, [
        {
          target_id: 'DOC-1',
          file: 'docs/modules/planning/technical.md',
          section: 'Overview',
          reason: 'docs',
          slice_id: 'SL-1',
          status: 'pending' as const,
        },
      ]);

      expect(Object.keys(snapshot)).toEqual(['DOC-1']);
      expect(readFileSync(join(root, 'docs/modules/planning/technical.md'), 'utf8')).toBe('body\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
