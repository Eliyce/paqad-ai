import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadObligationIndex } from '@/compliance/index-store.js';

describe('loadObligationIndex', () => {
  it('throws for invalid JSON (non-ENOENT errors)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));
    await mkdir(path.join(root, '.paqad', 'compliance'), { recursive: true });
    await writeFile(path.join(root, 'obligation-index.json'), '{not-json', 'utf8');

    await expect(
      loadObligationIndex({ project_root: root, index_path: 'obligation-index.json' }),
    ).rejects.toBeTruthy();
  });
});
