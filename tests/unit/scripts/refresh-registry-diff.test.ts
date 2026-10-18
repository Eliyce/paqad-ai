import { execa } from 'execa';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RunnerScriptGenerator } from '@/scripts';

import { scriptProfile } from './shared.fixture';

function git(root: string, args: string[]): void {
  execFileSync(
    'git',
    [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Test',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, stdio: 'ignore' },
  );
}

async function runDiffRefresh(root: string) {
  return execa(join(root, 'scripts/refresh-registry-diff.sh'), { reject: false, cwd: root });
}

describe('refresh-registry-diff.sh (issue #651)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-scripts-'));
    await new RunnerScriptGenerator().write(root, scriptProfile());
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to the full refresh outside a git repository', async () => {
    const result = await runDiffRefresh(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No git repository here');
    expect(result.stdout).toContain('refresh-registry demo-project');
    expect(result.stdout).not.toContain('No changed files log found');
  });

  it('refreshes from the uncommitted and branch-committed files git reports', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/base.ts'), 'export const base = 1;\n');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'base']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    writeFileSync(join(root, 'src/branch.ts'), 'export const branch = 1;\n');
    git(root, ['add', 'src/branch.ts']);
    git(root, ['commit', '-q', '-m', 'branch change']);
    writeFileSync(join(root, 'src/base.ts'), 'export const base = 2;\n');

    const result = await runDiffRefresh(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Diff refresh for demo-project (2 changed files)');
    expect(result.stdout.split('\n')).toEqual(
      expect.arrayContaining(['src/base.ts', 'src/branch.ts']),
    );
    expect(result.stdout).not.toContain('No changed files log found');
    expect(result.stdout).not.toContain('refresh-registry demo-project');
  });

  it('falls back to the full refresh when git reports nothing changed', async () => {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'base']);

    const result = await runDiffRefresh(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Git reports no changed files');
    expect(result.stdout).toContain('refresh-registry demo-project');
  });
});
