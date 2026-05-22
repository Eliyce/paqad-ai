import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';

import { detectStaleDocTargets, loadChangeEvidence } from '@/pipeline/change-evidence.js';

const mockedExeca = vi.mocked(execa);

function makeTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-ce-mocked-'));
}

describe('loadChangeEvidence (mocked execa)', () => {
  it('returns none when git throws an exception', async () => {
    mockedExeca.mockRejectedValueOnce(new Error('spawn ENOENT'));

    const root = makeTmpRoot();
    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('none');
    expect(result.files).toEqual([]);
  });

  it('skips malformed short lines in git status output', async () => {
    mockedExeca.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '??\n M  src/file.ts\n',
      stderr: '',
      failed: false,
      timedOut: false,
      isCanceled: false,
      killed: false,
      command: 'git status',
    } as Awaited<ReturnType<typeof execa>>);

    const root = makeTmpRoot();
    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('git-status');
    expect(result.files).toContain('src/file.ts');
    expect(result.files).not.toContain('??');
  });
});

describe('detectStaleDocTargets (mocked execa)', () => {
  it('returns empty array when detector script throws', async () => {
    mockedExeca.mockRejectedValueOnce(new Error('EACCES permission denied'));

    const root = makeTmpRoot();
    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([]);
  });
});
