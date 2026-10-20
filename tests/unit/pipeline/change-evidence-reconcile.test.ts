import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('@/rag/git-state.js', () => ({
  readGitState: vi.fn(),
}));

import { execa } from 'execa';

import { loadChangeEvidence, readGitChangedFiles } from '@/pipeline/change-evidence.js';
import { readGitState } from '@/rag/git-state.js';

const mockedExeca = vi.mocked(execa);
const mockedReadGitState = vi.mocked(readGitState);

function makeTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-ce-git-'));
}

function gitResult(stdout: string, exitCode = 0): Awaited<ReturnType<typeof execa>> {
  return {
    exitCode,
    stdout,
    stderr: '',
    failed: exitCode !== 0,
    timedOut: false,
    isCanceled: false,
    killed: false,
    command: 'git',
  } as Awaited<ReturnType<typeof execa>>;
}

describe('readGitChangedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadGitState.mockReturnValue({
      branch: 'feature',
      head_commit: 'HEAD_SHA',
      base_branch: 'main',
      base_commit: 'BASE_SHA',
    });
  });

  it('unions working-tree status with files committed since the base, sorted and de-duplicated', async () => {
    mockedExeca
      .mockResolvedValueOnce(gitResult(' M src/b.ts\n?? src/a.ts\n'))
      .mockResolvedValueOnce(gitResult('src/c.ts\nsrc/b.ts\n'));

    await expect(readGitChangedFiles(makeTmpRoot())).resolves.toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
    expect(mockedExeca).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'BASE_SHA..HEAD'],
      expect.anything(),
    );
  });

  it('degrades to working-tree status when the committed-since-base diff exits non-zero', async () => {
    mockedExeca
      .mockResolvedValueOnce(gitResult(' M src/a.ts\n'))
      .mockResolvedValueOnce(gitResult('', 1));

    const result = await loadChangeEvidence(makeTmpRoot());

    expect(result).toEqual({ files: ['src/a.ts'], source: 'git' });
  });

  it('degrades to working-tree status when the committed-since-base diff throws', async () => {
    mockedExeca
      .mockResolvedValueOnce(gitResult(' M src/a.ts\n'))
      .mockRejectedValueOnce(new Error('spawn ENOENT'));

    const result = await loadChangeEvidence(makeTmpRoot());

    expect(result).toEqual({ files: ['src/a.ts'], source: 'git' });
  });

  it('returns branch-committed files on a clean tree', async () => {
    mockedExeca.mockResolvedValueOnce(gitResult('')).mockResolvedValueOnce(gitResult('src/b.ts\n'));

    const result = await loadChangeEvidence(makeTmpRoot());

    expect(result).toEqual({ files: ['src/b.ts'], source: 'git' });
  });

  it('reads working-tree status only when git has no base commit', async () => {
    mockedReadGitState.mockReturnValueOnce({ head_commit: 'HEAD_SHA' });
    mockedExeca.mockResolvedValueOnce(gitResult(' M src/a.ts\n'));

    const result = await loadChangeEvidence(makeTmpRoot());

    expect(result).toEqual({ files: ['src/a.ts'], source: 'git' });
    expect(mockedExeca).toHaveBeenCalledTimes(1);
  });

  it('reads working-tree status only when git has no head commit', async () => {
    mockedReadGitState.mockReturnValueOnce({ base_commit: 'BASE_SHA' });
    mockedExeca.mockResolvedValueOnce(gitResult(''));

    const result = await loadChangeEvidence(makeTmpRoot());

    expect(result).toEqual({ files: [], source: 'none' });
    expect(mockedExeca).toHaveBeenCalledTimes(1);
  });

  it('is none, never a throw, when every git call fails', async () => {
    mockedExeca
      .mockRejectedValueOnce(new Error('spawn ENOENT'))
      .mockRejectedValueOnce(new Error('spawn ENOENT'));

    await expect(loadChangeEvidence(makeTmpRoot())).resolves.toEqual({
      files: [],
      source: 'none',
    });
  });
});
