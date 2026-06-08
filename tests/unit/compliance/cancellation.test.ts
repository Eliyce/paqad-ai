import { mkdtemp, mkdir, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkSpecCompliance } from '@/compliance/compliance-checker.js';
import { isCancelledError } from '@/core/errors/cancelled-error.js';
import type { ObligationIndex } from '@/compliance/types.js';

function makeIndex(): ObligationIndex {
  return {
    metadata: {
      spec_file: 'docs/spec.md',
      spec_hash: 'hash',
      extracted_at: '2026-04-07T00:00:00.000Z',
      obligation_count: 0,
      schema_version: 1,
      warnings: [],
    },
    obligations: [],
  };
}

describe('checkSpecCompliance consumer cancellation (PQD-104)', () => {
  it('throws CancelledError before scanning and writes no report when pre-aborted', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-compliance-cancel-'));
    await mkdir(path.join(root, 'tests'), { recursive: true });

    const controller = new AbortController();
    controller.abort();

    let cancelled = false;
    try {
      await checkSpecCompliance({
        project_root: root,
        index: makeIndex(),
        report_path: '.paqad/compliance/report.json',
        signal: controller.signal,
      });
    } catch (error) {
      cancelled = isCancelledError(error);
    }

    expect(cancelled).toBe(true);
    // No report directory was created — the call wrote nothing to disk.
    await expect(readdir(path.join(root, '.paqad'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
