import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { readGitState } from '@/rag/git-state.js';

const mockedExeca = vi.mocked(execa);
const mockedReadGitState = vi.mocked(readGitState);

function makeTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-ce-reconcile-'));
}

function writeChangedFiles(root: string, files: string[]): void {
  const dir = join(root, '.paqad', 'session');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'changed-files.json'), JSON.stringify(files));
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

describe('loadChangeEvidence reconciliation (mocked git-state + execa, issue #450)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A resolvable git state with a base branch, so reconciliation engages.
    mockedReadGitState.mockReturnValue({
      branch: 'feature',
      head_commit: 'HEAD_SHA',
      base_branch: 'main',
      base_commit: 'BASE_SHA',
    });
  });

  it('degrades to working-tree-only when the committed-since-base diff exits non-zero', async () => {
    const root = makeTmpRoot();
    writeChangedFiles(root, ['src/a.ts']);
    mockedExeca
      .mockResolvedValueOnce(gitResult(' M src/a.ts\n')) // status: a.ts is dirty
      .mockResolvedValueOnce(gitResult('', 1)); // diff base..HEAD: non-zero -> empty committed set

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('session-artifact');
    expect(result.files).toEqual(['src/a.ts']);
  });

  it('degrades to working-tree-only when the committed-since-base diff throws', async () => {
    const root = makeTmpRoot();
    writeChangedFiles(root, ['src/a.ts']);
    mockedExeca
      .mockResolvedValueOnce(gitResult(' M src/a.ts\n')) // status: a.ts is dirty
      .mockRejectedValueOnce(new Error('spawn ENOENT')); // diff throws -> caught -> empty

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('session-artifact');
    expect(result.files).toEqual(['src/a.ts']);
  });

  it('keeps an entry present only in the committed-since-base diff', async () => {
    const root = makeTmpRoot();
    writeChangedFiles(root, ['src/b.ts']);
    mockedExeca
      .mockResolvedValueOnce(gitResult('')) // status: clean
      .mockResolvedValueOnce(gitResult('src/b.ts\n')); // diff base..HEAD: b.ts committed on branch

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('session-artifact');
    expect(result.files).toEqual(['src/b.ts']);
  });

  it('skips reconciliation and trusts the artifact when git has no base commit', async () => {
    const root = makeTmpRoot();
    writeChangedFiles(root, ['src/a.ts']);
    mockedReadGitState.mockReturnValueOnce({ head_commit: 'HEAD_SHA' }); // no base_commit

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('session-artifact');
    expect(result.files).toEqual(['src/a.ts']);
    expect(mockedExeca).not.toHaveBeenCalled();
  });
});
