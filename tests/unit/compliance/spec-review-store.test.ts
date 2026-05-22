import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSpecReviewReport, saveSpecReviewReport } from '@/compliance/spec-review-store.js';
import type { SpecReviewReport } from '@/compliance/types.js';

describe('spec-review-store', () => {
  it('saves and loads a spec review report using the spec-derived default path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-spec-review-'));
    const report: SpecReviewReport = {
      metadata: {
        spec_file: 'docs/spec.md',
        spec_hash: 'hash',
        reviewed_at: '2026-04-08T00:00:00.000Z',
        defect_count: 1,
        schema_version: 1,
      },
      defects: [],
      pattern_advisories: [],
    };

    const savedPath = await saveSpecReviewReport({
      project_root: root,
      spec_file: 'docs/spec.md',
      report,
    });
    const loaded = await loadSpecReviewReport({
      project_root: root,
      spec_file: 'docs/spec.md',
    });

    expect(savedPath).toContain(path.join('.paqad', 'compliance', 'spec', 'spec-review.json'));
    expect(loaded).toEqual(report);
  });

  it('returns null when no review report exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-spec-review-missing-'));
    await expect(
      loadSpecReviewReport({
        project_root: root,
        spec_file: 'docs/spec.md',
      }),
    ).resolves.toBeNull();
  });

  it('throws when neither a spec file nor explicit review path is provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-spec-review-error-'));
    await expect(
      loadSpecReviewReport({
        project_root: root,
      }),
    ).rejects.toThrow('spec_file or review_path is required');
  });

  it('rethrows non-ENOENT read failures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-spec-review-json-'));
    const badPath = path.join(root, 'broken.json');
    await saveSpecReviewReport({
      project_root: root,
      review_path: 'broken.json',
      report: {
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          reviewed_at: '2026-04-08T00:00:00.000Z',
          defect_count: 0,
          schema_version: 1,
        },
        defects: [],
        pattern_advisories: [],
      },
    });
    await writeFile(badPath, '{not-json', 'utf8');

    await expect(
      loadSpecReviewReport({
        project_root: root,
        review_path: 'broken.json',
      }),
    ).rejects.toBeTruthy();
  });
});
