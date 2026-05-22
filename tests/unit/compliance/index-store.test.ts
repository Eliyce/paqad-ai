import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadObligationIndex, saveObligationIndex } from '@/compliance/index-store.js';
import { DEFAULT_OBLIGATION_INDEX_PATH } from '@/compliance/constants.js';
import type { ObligationIndex } from '@/compliance/types.js';

function createIndex(specFile: string): ObligationIndex {
  return {
    metadata: {
      spec_file: specFile,
      spec_hash: 'hash',
      extracted_at: '2026-04-07T00:00:00.000Z',
      obligation_count: 0,
      schema_version: 1,
      warnings: [],
    },
    obligations: [],
  };
}

describe('index-store', () => {
  it('returns null when index does not exist', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));

    const index = await loadObligationIndex({
      project_root: root,
      index_path: '.paqad/compliance/missing.json',
    });
    expect(index).toBeNull();
  });

  it('saves and loads an obligation index as JSON', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));

    const indexPath = await saveObligationIndex({
      project_root: root,
      index_path: '.paqad/compliance/obligation-index.json',
      index: createIndex('docs/spec.md'),
    });

    const raw = await readFile(indexPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);

    const loaded = await loadObligationIndex({
      project_root: root,
      index_path: '.paqad/compliance/obligation-index.json',
    });
    expect(loaded?.metadata.spec_file).toBe('docs/spec.md');
  });

  it('uses the default index path when none is provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));

    const indexPath = await saveObligationIndex({
      project_root: root,
      index: createIndex('docs/spec.md'),
    });
    expect(indexPath.endsWith(DEFAULT_OBLIGATION_INDEX_PATH)).toBe(true);

    const loaded = await loadObligationIndex({ project_root: root });
    expect(loaded?.metadata.spec_file).toBe('docs/spec.md');
  });
});
