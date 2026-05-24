import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import { vi } from 'vitest';

vi.mock('@/compliance/defect-patterns/store.js', () => ({
  queryPatterns: vi.fn().mockResolvedValue([
    {
      pattern_id: 'DP-1',
      subcategory: 'missing-tests',
      description: 'Missing regression tests',
      frequency: 11,
    },
  ]),
}));

import {
  detectContractBoundaries,
  injectContractBoundaryCriteria,
} from '@/planning/contract-boundary.js';
import {
  injectDefectAdvisoryCriteria,
  queryMatchingDefectPatterns,
} from '@/planning/defect-advisory.js';
import { computeDelta, mergeDeltaManifest } from '@/planning/delta-merger.js';
import { resolveDocTargets } from '@/planning/doc-target-resolver.js';
import { computePlanVsActual, writePlanVsActual } from '@/planning/plan-vs-actual.js';
import { emitTestSkeletons } from '@/planning/skeleton-emitter.js';

import { createManifest } from './fixtures.js';

describe('planning operational helpers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'planning-ops-'));
    mkdirSync(join(root, 'src/planning'), { recursive: true });
    mkdirSync(join(root, 'src/consumer'), { recursive: true });
    mkdirSync(join(root, 'docs/modules/planning'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('detects contract boundaries and injects boundary criteria', async () => {
    writeFileSync(
      join(root, 'src/planning/index.ts'),
      'export function stableApi() { return true; }\n',
    );
    writeFileSync(
      join(root, 'src/consumer/use.ts'),
      "import { stableApi } from '../planning/index.js';\nexport const value = stableApi();\n",
    );

    const boundaries = await detectContractBoundaries(root, ['src/planning/index.ts']);
    expect(boundaries).toEqual([
      expect.objectContaining({
        symbol: 'stableApi',
        importers: ['src/consumer/use.ts'],
      }),
    ]);

    const manifest = createManifest({
      verification_matrix: [{ ...createManifest().verification_matrix[0], criterion_id: 'bad' }],
    });
    expect(injectContractBoundaryCriteria(manifest, boundaries).verification_matrix).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'contract-boundary' })]),
    );

    writeFileSync(join(root, 'src/planning/no-export.ts'), 'const local = true;\n');
    await expect(detectContractBoundaries(root, ['src/planning/no-export.ts'])).resolves.toEqual(
      [],
    );

    writeFileSync(
      join(root, 'src/planning/fallback.ts'),
      'export function exportedContract() { return true; }\n',
    );
    writeFileSync(
      join(root, 'src/consumer/unused.ts'),
      'export const untouched = "no importer match here";\n',
    );
    await expect(detectContractBoundaries(root, ['src/planning/fallback.ts'])).resolves.toEqual([]);

    expect(injectContractBoundaryCriteria(manifest, [])).toBe(manifest);
  });

  it('wraps defect pattern lookups and injects advisory criteria', async () => {
    const patterns = await queryMatchingDefectPatterns({
      stack: 'node-cli',
      affectedModules: ['planning'],
    });
    expect(patterns).toHaveLength(1);

    const manifest = injectDefectAdvisoryCriteria(createManifest(), patterns as never);
    expect(manifest.verification_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'defect-pattern',
          then: expect.stringContaining('must avoid'),
        }),
      ]),
    );

    expect(
      injectDefectAdvisoryCriteria(
        createManifest({
          verification_matrix: [
            { ...createManifest().verification_matrix[0], criterion_id: 'bad' },
          ],
          requirement_graph: [],
          classification: { ...createManifest().classification, affected_modules: [] },
        }),
        [{ ...(patterns[0] as never), frequency: 3 }] as never,
      ).verification_matrix,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          then: expect.stringContaining('should avoid'),
          when: expect.stringContaining('in scope'),
        }),
      ]),
    );
    expect(injectDefectAdvisoryCriteria(createManifest(), []).verification_matrix).toHaveLength(
      createManifest().verification_matrix.length,
    );
  });

  it('emits skeletons, resolves doc targets, merges deltas, and records plan-vs-actual', async () => {
    writeFileSync(join(root, 'docs/modules/planning/technical.md'), '# Technical Notes\n');

    const manifest = createManifest({
      verification_matrix: [
        {
          ...createManifest().verification_matrix[0],
          negative_cases: [{ input: 'bad', expected_behavior: 'reject' }],
          edge_cases: [{ input: 'edge', expected_behavior: 'handle' }],
          adversarial_cases: [{ input: 'evil', expected_behavior: 'guard' }],
        },
      ],
    });

    await expect(
      emitTestSkeletons(root, manifest.verification_matrix, 'node-cli'),
    ).resolves.toEqual(['tests/unit/planning/generated.test.ts']);
    expect(readFileSync(join(root, 'tests/unit/planning/generated.test.ts'), 'utf8')).toContain(
      'Not implemented',
    );

    await expect(
      resolveDocTargets(root, manifest.execution_slices, 'breaking-change', 'redesign'),
    ).resolves.toEqual([
      expect.objectContaining({
        file: 'docs/modules/planning/technical.md',
      }),
    ]);
    await expect(
      resolveDocTargets(
        root,
        [
          {
            ...createManifest().execution_slices[0],
            touches: [
              'src/planning/api/index.ts',
              'src/planning/components/widget.ts',
              'src/planning/components/widget.ts',
              'app/planning/controller.ts',
              'notes.txt',
            ],
          },
        ],
        'breaking-change',
        'redesign',
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'docs/modules/planning/api/endpoints.md' }),
        expect.objectContaining({ file: 'docs/modules/planning/ui/components.md' }),
      ]),
    );

    const updated = createManifest({
      requirement_graph: [
        ...createManifest().requirement_graph,
        {
          id: 'FR-2',
          type: 'functional',
          description: 'Track plan vs actual.',
          depends_on: ['FR-1'],
          scope: ['src/planning/plan-vs-actual.ts'],
          risk: 'low',
        },
      ],
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          touches: ['src/planning/index.ts', 'src/planning/plan-vs-actual.ts'],
        },
      ],
    });
    const delta = computeDelta(createManifest(), updated);
    expect(delta.requirement_graph.added).toHaveLength(1);
    expect(mergeDeltaManifest(createManifest(), updated).requirement_graph).toHaveLength(2);

    const diff = computePlanVsActual(updated, {
      changed_files: ['src/planning/index.ts', 'src/planning/plan-vs-actual.ts'],
      used_files: ['src/planning/index.ts'],
      covered_criteria: ['AC-1'],
    });
    expect(diff.scope_accuracy_pct).toBe(100);
    expect(diff.planned_but_unused_files).toEqual(['src/planning/plan-vs-actual.ts']);
    expect(
      computePlanVsActual(createManifest({ execution_slices: [], verification_matrix: [] }), {
        changed_files: [],
      }),
    ).toMatchObject({
      scope_accuracy_pct: 100,
      criteria_pass_rate_pct: 100,
    });
    await expect(writePlanVsActual(root, 'planning-manifest', diff)).resolves.toContain(
      '.paqad/specs/planning-manifest.plan-vs-actual.json',
    );
  });

  it('covers empty automated skeleton emission and rule injection guard rails', async () => {
    await expect(
      emitTestSkeletons(
        root,
        [{ ...createManifest().verification_matrix[0], proof_type: 'manual' }],
        'node-cli',
      ),
    ).resolves.toEqual([]);
    await expect(
      emitTestSkeletons(root, createManifest().verification_matrix, 'node-cli'),
    ).resolves.toEqual(['tests/unit/planning/generated.test.ts']);

    const { injectRuleCriteria } = await import('@/planning/rule-injection.js');
    expect(injectRuleCriteria(createManifest(), null)).toEqual(createManifest());
    expect(
      injectRuleCriteria(
        createManifest({
          execution_slices: [{ ...createManifest().execution_slices[0], covers: ['AC-1'] }],
        }),
        {
          schema_version: 1,
          generated_at: '2026-04-10T00:00:00.000Z',
          source_hash: 'sha256:test',
          rules: [
            {
              rule_id: 'RULE-1',
              title: 'No match',
              source_path: 'docs/instructions/rules/no-match.md',
              trigger_patterns: ['does-not-match'],
              severity: 'must',
              summary: 'Never reached',
            },
            {
              rule_id: 'RULE-2',
              title: 'No linked requirements',
              source_path: 'docs/instructions/rules/no-links.md',
              trigger_patterns: ['src/planning'],
              severity: 'must',
              summary: 'Still skipped',
            },
          ],
        },
      ).verification_matrix,
    ).toHaveLength(createManifest().verification_matrix.length);

    expect(
      injectRuleCriteria(
        createManifest({
          verification_matrix: [
            {
              ...createManifest().verification_matrix[0],
              criterion_id: 'bad',
              rule_id: 'RULE-1',
            },
          ],
          execution_slices: [{ ...createManifest().execution_slices[0], covers: ['FR-1', 'AC-1'] }],
        }),
        {
          schema_version: 1,
          generated_at: '2026-04-10T00:00:00.000Z',
          source_hash: 'sha256:test',
          rules: [
            {
              rule_id: 'RULE-1',
              title: 'Existing duplicate',
              source_path: 'docs/instructions/rules/dup.md',
              trigger_patterns: ['src/planning'],
              severity: 'must',
              summary: 'duplicate',
            },
          ],
        },
      ).verification_matrix,
    ).toHaveLength(1);

    const merged = mergeDeltaManifest(createManifest(), {
      ...createManifest(),
      doc_targets: [
        {
          target_id: 'DOC-1',
          file: 'docs/modules/planning/technical.md',
          section: 'Technical Notes',
          reason: 'updated',
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
    expect(merged.doc_targets).toHaveLength(1);
    expect(merged.regression_watch).toHaveLength(1);

    await expect(
      resolveDocTargets(join(root, 'missing-root'), createManifest().execution_slices),
    ).resolves.toEqual([]);
  });
});
