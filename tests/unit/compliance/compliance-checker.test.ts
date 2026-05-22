import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkSpecCompliance } from '@/compliance/compliance-checker.js';
import type { ObligationIndex } from '@/compliance/types.js';

async function makeTempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  return root;
}

function makeIndex(obligations: ObligationIndex['obligations']): ObligationIndex {
  return {
    metadata: {
      spec_file: 'docs/spec.md',
      spec_hash: 'hash',
      extracted_at: '2026-04-07T00:00:00.000Z',
      obligation_count: obligations.length,
      schema_version: 1,
      warnings: [],
    },
    obligations,
  };
}

describe('checkSpecCompliance', () => {
  it('classifies covered/partial/uncovered/indeterminate and enforces invariants', async () => {
    // FR-1-T1: covered by @obligation annotation
    // FR-1-T2: covered because obligation ID appears in a test call name (FR-3.2 strong signal)
    // FR-1-T3: partial — ID appears in file content but not in a test name or annotation
    // FR-1-T4: uncovered — no mention anywhere
    // GEN-AAAAAAAAAAAA: indeterminate — GEN- prefix and no evidence
    const root = await makeTempProject();

    await writeFile(
      path.join(root, 'tests', 'a.test.ts'),
      [
        "import { it, expect } from 'vitest';",
        '',
        "it('covers FR-1-T1 with annotation', () => {",
        '  // @obligation FR-1-T1',
        '  expect(true).toBe(true);',
        '});',
        '',
        "it('FR-1-T2: obligation ID in the test name', () => {",
        '  expect(true).toBe(true);',
        '});',
        '',
        '// Reference to FR-1-T3 outside any test name (partial signal only).',
        "const _ref = 'FR-1-T3';",
        '',
      ].join('\n'),
      'utf8',
    );

    const index = makeIndex([
      {
        obligation_id: 'FR-1-T1',
        category: 'functional',
        description: 'Covered by annotation',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 1,
        spec_file: 'docs/spec.md',
      },
      {
        obligation_id: 'FR-1-T2',
        category: 'functional',
        description: 'Covered by test name',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 2,
        spec_file: 'docs/spec.md',
      },
      {
        obligation_id: 'FR-1-T3',
        category: 'functional',
        description: 'Partially covered obligation',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 3,
        spec_file: 'docs/spec.md',
      },
      {
        obligation_id: 'FR-1-T4',
        category: 'functional',
        description: 'Uncovered obligation',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 4,
        spec_file: 'docs/spec.md',
      },
      {
        obligation_id: 'GEN-AAAAAAAAAAAA',
        category: 'acceptance',
        description: 'Generated obligation',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 5,
        spec_file: 'docs/spec.md',
      },
    ]);

    const report = await checkSpecCompliance({ project_root: root, index });
    const byId = new Map(report.obligations.map((o) => [o.obligation_id, o]));

    expect(byId.get('FR-1-T1')!.state).toBe('covered');
    expect(byId.get('FR-1-T1')!.evidence).toHaveLength(1);

    // FR-3.2: exact ID in test name is a strong coverage signal → covered
    expect(byId.get('FR-1-T2')!.state).toBe('covered');
    expect(byId.get('FR-1-T2')!.evidence).toHaveLength(1);

    expect(byId.get('FR-1-T3')!.state).toBe('partial');
    expect(byId.get('FR-1-T4')!.state).toBe('uncovered');
    expect(byId.get('GEN-AAAAAAAAAAAA')!.state).toBe('indeterminate');

    expect(report.summary.total).toBe(5);
    expect(report.summary.covered).toBe(2);
    expect(report.summary.partial).toBe(1);
    expect(report.summary.uncovered).toBe(1);
    expect(report.summary.indeterminate).toBe(1);

    // FR-3.3: compliance_ratio = covered / (total - indeterminate) = 2 / (5 - 1) = 0.5
    expect(report.summary.compliance_ratio).toBe(0.5);
  });

  it('returns compliance_ratio 1 for an empty index', async () => {
    const root = await makeTempProject();
    const report = await checkSpecCompliance({ project_root: root, index: makeIndex([]) });
    expect(report.summary.total).toBe(0);
    expect(report.summary.compliance_ratio).toBe(1);
  });

  it('returns compliance_ratio 1 when all obligations are indeterminate (zero denominator guard)', async () => {
    const root = await makeTempProject();
    const report = await checkSpecCompliance({
      project_root: root,
      index: makeIndex([
        {
          obligation_id: 'GEN-AAAAAAAAAAAA',
          category: 'acceptance',
          description: 'Generated',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
        },
      ]),
    });
    expect(report.summary.indeterminate).toBe(1);
    expect(report.summary.uncovered).toBe(0);
    // denominator = 1 - 1 = 0 → guarded → ratio 1
    expect(report.summary.compliance_ratio).toBe(1);
  });

  it('treats GEN-prefixed obligation annotations as direct evidence', async () => {
    const root = await makeTempProject();

    await writeFile(
      path.join(root, 'tests', 'generated.test.ts'),
      ['it("covers generated", () => {', '  // @obligation GEN-ABC123DEF456', '});', ''].join('\n'),
      'utf8',
    );

    const report = await checkSpecCompliance({
      project_root: root,
      index: makeIndex([
        {
          obligation_id: 'GEN-ABC123DEF456',
          category: 'acceptance',
          description: 'Generated obligation',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
        },
      ]),
    });

    expect(report.obligations[0]!.state).toBe('covered');
    expect(report.obligations[0]!.evidence).toHaveLength(1);
    expect(report.summary.covered).toBe(1);
    expect(report.summary.partial).toBe(0);
  });

  it('compliance_ratio excludes indeterminate from denominator', async () => {
    // 3 covered, 0 partial, 1 uncovered, 2 indeterminate → total 6
    // ratio = 3 / (6 - 2) = 3/4 = 0.75
    const root = await makeTempProject();

    await writeFile(
      path.join(root, 'tests', 'mixed.test.ts'),
      [
        "it('covers FR-A-T1', () => { /* @obligation FR-A-T1 */ });",
        "it('covers FR-A-T2', () => { /* @obligation FR-A-T2 */ });",
        "it('covers FR-A-T3', () => { /* @obligation FR-A-T3 */ });",
        '',
      ].join('\n'),
      'utf8',
    );

    const obligations: ObligationIndex['obligations'] = [
      ...['FR-A-T1', 'FR-A-T2', 'FR-A-T3'].map((id) => ({
        obligation_id: id,
        category: 'functional' as const,
        description: id,
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 1,
        spec_file: 'docs/spec.md',
      })),
      {
        obligation_id: 'FR-A-T4',
        category: 'functional',
        description: 'Uncovered',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 4,
        spec_file: 'docs/spec.md',
      },
      ...['GEN-AAAAAAAAAA01', 'GEN-AAAAAAAAAA02'].map((id) => ({
        obligation_id: id,
        category: 'acceptance' as const,
        description: 'Generated',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 5,
        spec_file: 'docs/spec.md',
      })),
    ];

    const report = await checkSpecCompliance({ project_root: root, index: makeIndex(obligations) });

    expect(report.summary.total).toBe(6);
    expect(report.summary.covered).toBe(3);
    expect(report.summary.uncovered).toBe(1);
    expect(report.summary.indeterminate).toBe(2);
    expect(report.summary.compliance_ratio).toBe(0.75);
  });

  // FR-3.3: uncovered_obligations convenience array
  it('populates uncovered_obligations with IDs of uncovered obligations (FR-3.3)', async () => {
    const root = await makeTempProject();
    await writeFile(
      path.join(root, 'tests', 'a.test.ts'),
      "it('FR-A-T1 covered', () => { /* @obligation FR-A-T1 */ });\n",
      'utf8',
    );

    const index = makeIndex([
      {
        obligation_id: 'FR-A-T1',
        category: 'functional',
        description: 'Covered',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 1,
        spec_file: 'docs/spec.md',
      },
      {
        obligation_id: 'FR-A-T2',
        category: 'functional',
        description: 'Uncovered',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 2,
        spec_file: 'docs/spec.md',
      },
      {
        obligation_id: 'FR-A-T3',
        category: 'functional',
        description: 'Also uncovered',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 3,
        spec_file: 'docs/spec.md',
      },
    ]);

    const report = await checkSpecCompliance({ project_root: root, index });

    expect(report.uncovered_obligations).toEqual(['FR-A-T2', 'FR-A-T3']);
    expect(report.uncovered_obligations.length).toBe(report.summary.uncovered);
  });

  it('uncovered_obligations is empty when all obligations are covered (FR-3.3)', async () => {
    const root = await makeTempProject();
    await writeFile(
      path.join(root, 'tests', 'full.test.ts'),
      "it('x', () => { /* @obligation FR-B-T1 */ });\n",
      'utf8',
    );
    const index = makeIndex([
      {
        obligation_id: 'FR-B-T1',
        category: 'functional',
        description: 'Covered',
        pass_criteria: null,
        source_section: 'Spec',
        source_line: 1,
        spec_file: 'docs/spec.md',
      },
    ]);
    const report = await checkSpecCompliance({ project_root: root, index });
    expect(report.uncovered_obligations).toEqual([]);
  });

  // FR-3.5 + FR-3.6: report persistence and incremental caching
  it('persists the report to disk when report_path is provided (FR-3.5)', async () => {
    const root = await makeTempProject();
    const reportPath = '.paqad/compliance/test-spec/report.json';
    const index = makeIndex([]);

    await checkSpecCompliance({ project_root: root, index, report_path: reportPath });

    const fullPath = path.resolve(root, reportPath);
    const raw = await readFile(fullPath, 'utf8');
    const persisted = JSON.parse(raw);
    expect(persisted.metadata.spec_file).toBe('docs/spec.md');
    expect(persisted.metadata.cache_hit).toBe(false);
    expect(typeof persisted.metadata.test_files_hash).toBe('string');
  });

  it('returns cache_hit: false on first run and cache_hit: true on second run with no file changes (FR-3.6)', async () => {
    const root = await makeTempProject();
    const reportPath = '.paqad/compliance/test-spec/report.json';
    const index = makeIndex([]);

    const first = await checkSpecCompliance({ project_root: root, index, report_path: reportPath });
    expect(first.metadata.cache_hit).toBe(false);

    const second = await checkSpecCompliance({
      project_root: root,
      index,
      report_path: reportPath,
    });
    expect(second.metadata.cache_hit).toBe(true);
  });

  it('invalidates cache when a test file changes (FR-3.6)', async () => {
    const root = await makeTempProject();
    const reportPath = '.paqad/compliance/test-spec/report.json';
    const testFile = path.join(root, 'tests', 'a.test.ts');
    await writeFile(testFile, "it('initial', () => {});\n", 'utf8');

    const index = makeIndex([]);

    const first = await checkSpecCompliance({ project_root: root, index, report_path: reportPath });
    expect(first.metadata.cache_hit).toBe(false);

    // Mutate the test file
    await writeFile(testFile, "it('changed', () => {});\n", 'utf8');

    const second = await checkSpecCompliance({
      project_root: root,
      index,
      report_path: reportPath,
    });
    expect(second.metadata.cache_hit).toBe(false);
  });

  it('invalidates cache when the spec changes (FR-3.6)', async () => {
    const root = await makeTempProject();
    const reportPath = '.paqad/compliance/test-spec/report.json';

    const index1 = makeIndex([]);
    const first = await checkSpecCompliance({
      project_root: root,
      index: index1,
      report_path: reportPath,
    });
    expect(first.metadata.cache_hit).toBe(false);

    // Different spec_hash simulates spec modification
    const index2 = { ...index1, metadata: { ...index1.metadata, spec_hash: 'new-hash' } };
    const second = await checkSpecCompliance({
      project_root: root,
      index: index2,
      report_path: reportPath,
    });
    expect(second.metadata.cache_hit).toBe(false);
  });

  it('summarizes unresolved critical spec defects when a review is supplied', async () => {
    const root = await makeTempProject();
    await writeFile(
      path.join(root, 'tests', 'covered.test.ts'),
      "it('covered', () => { /* @obligation FR-1-T1 */ });\n",
      'utf8',
    );

    const report = await checkSpecCompliance({
      project_root: root,
      index: makeIndex([
        {
          obligation_id: 'FR-1-T1',
          category: 'functional',
          description: 'Covered obligation',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
        },
      ]),
      spec_review: {
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          reviewed_at: '2026-04-08T00:00:00.000Z',
          defect_count: 2,
          schema_version: 1,
        },
        defects: [
          {
            defect_id: 'SQ-1',
            category: 'contradiction',
            severity: 'critical',
            description: 'Critical defect',
            locations: [{ section: 'Spec', line_range: [1, 1], text_excerpt: 'x' }],
            suggested_resolution: 'Fix',
            affected_obligation_ids: ['FR-1-T1'],
            status: 'new',
          },
          {
            defect_id: 'SQ-2',
            category: 'boundary_gap',
            severity: 'major',
            description: 'Resolved defect',
            locations: [{ section: 'Spec', line_range: [2, 2], text_excerpt: 'y' }],
            suggested_resolution: 'Fix',
            affected_obligation_ids: ['FR-1-T1'],
            status: 'resolved',
          },
        ],
        pattern_advisories: [],
      },
    });

    expect(report.spec_review).toEqual({
      defect_count: 1,
      critical_count: 1,
      warning: '1 critical spec defects remain unresolved — compliance results may be unreliable.',
    });
  });

  it('omits the warning when unresolved spec defects are non-critical', async () => {
    const root = await makeTempProject();
    await writeFile(
      path.join(root, 'tests', 'covered.test.ts'),
      "it('covered', () => { /* @obligation FR-1-T1 */ });\n",
      'utf8',
    );

    const report = await checkSpecCompliance({
      project_root: root,
      index: makeIndex([
        {
          obligation_id: 'FR-1-T1',
          category: 'functional',
          description: 'Covered obligation',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
        },
      ]),
      spec_review: {
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          reviewed_at: '2026-04-08T00:00:00.000Z',
          defect_count: 1,
          schema_version: 1,
        },
        defects: [
          {
            defect_id: 'SQ-1',
            category: 'boundary_gap',
            severity: 'major',
            description: 'Major defect',
            locations: [{ section: 'Spec', line_range: [1, 1], text_excerpt: 'x' }],
            suggested_resolution: 'Fix',
            affected_obligation_ids: ['FR-1-T1'],
            status: 'new',
          },
        ],
        pattern_advisories: [],
      },
    });

    expect(report.spec_review).toEqual({
      defect_count: 1,
      critical_count: 0,
      warning: null,
    });
  });
});
