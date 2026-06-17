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
      stdout: '??\n M src/file.ts\n',
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

  it('preserves the first path character for worktree-only (leading-space) changes', async () => {
    // Real `git status --short` porcelain: ` M ` (one separator space) for a
    // tracked, unstaged modification; `?? ` for an untracked file. The leading
    // space on the modified line must not shift the path slice.
    mockedExeca.mockResolvedValueOnce({
      exitCode: 0,
      stdout:
        ' M package.json\n?? runtime/scripts/postinstall.mjs\nR  old/name.ts -> new/name.ts\n',
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
    expect(result.files).toContain('package.json');
    expect(result.files).not.toContain('ackage.json');
    expect(result.files).toContain('runtime/scripts/postinstall.mjs');
    expect(result.files).toContain('new/name.ts');
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
