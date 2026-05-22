import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkSpecCompliance } from '@/compliance/compliance-checker.js';
import type { ObligationIndex } from '@/compliance/types.js';

describe('checkSpecCompliance branches', () => {
  it('dedupes evidence across files and supports custom test globs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));
    await mkdir(path.join(root, 'custom-tests'), { recursive: true });

    await writeFile(
      path.join(root, 'custom-tests', 'a.spec.ts'),
      ['// @obligation FR-1-T1', '// @obligation FR-1-T1', ''].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(root, 'custom-tests', 'b.spec.ts'),
      ['// @obligation FR-1-T1', ''].join('\n'),
      'utf8',
    );

    const index: ObligationIndex = {
      metadata: {
        spec_file: 'docs/spec.md',
        spec_hash: 'hash',
        extracted_at: '2026-04-07T00:00:00.000Z',
        obligation_count: 1,
        schema_version: 1,
        warnings: [],
      },
      obligations: [
        {
          obligation_id: 'FR-1-T1',
          category: 'functional',
          description: 'One',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
        },
      ],
    };

    const report = await checkSpecCompliance({
      project_root: root,
      index,
      test_globs: ['custom-tests/**/*.spec.ts'],
    });

    expect(report.obligations[0]!.evidence.length).toBe(2);
    expect(report.obligations[0]!.state).toBe('covered');
  });

  it('handles empty test sets and overlapping globs deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));
    await mkdir(path.join(root, 'tests'), { recursive: true });

    const index: ObligationIndex = {
      metadata: {
        spec_file: 'docs/spec.md',
        spec_hash: 'hash',
        extracted_at: '2026-04-07T00:00:00.000Z',
        obligation_count: 1,
        schema_version: 1,
        warnings: [],
      },
      obligations: [
        {
          obligation_id: 'FR-1-T1',
          category: 'functional',
          description: 'One',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
        },
      ],
    };

    const report = await checkSpecCompliance({
      project_root: root,
      index,
      test_globs: ['tests/**/*.test.ts', 'tests/**/*.*'],
    });

    expect(report.summary.total).toBe(1);
    expect(report.obligations[0]!.state).toBe('uncovered');
    expect(report.obligations[0]!.evidence).toEqual([]);
  });

  it('marks non-generated obligations as uncovered when not referenced anywhere', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));
    await mkdir(path.join(root, 'tests'), { recursive: true });
    await writeFile(path.join(root, 'tests', 'empty.test.ts'), 'export {};', 'utf8');

    const index: ObligationIndex = {
      metadata: {
        spec_file: 'docs/spec.md',
        spec_hash: 'hash',
        extracted_at: '2026-04-07T00:00:00.000Z',
        obligation_count: 1,
        schema_version: 1,
        warnings: [],
      },
      obligations: [
        {
          obligation_id: 'FR-9-T1',
          category: 'functional',
          description: 'Uncovered',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
        },
      ],
    };

    const report = await checkSpecCompliance({ project_root: root, index });
    expect(report.obligations[0]!.state).toBe('uncovered');
    expect(report.summary.compliance_ratio).toBe(0);
  });
});
