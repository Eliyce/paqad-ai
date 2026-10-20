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

describe('refresh-registry-diff.sh', () => {
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

  it('reads paths with spaces as they are and follows a rename to its new path', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/old name.ts'), 'export const a = 1;\n');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'base']);
    git(root, ['mv', 'src/old name.ts', 'src/new name.ts']);
    writeFileSync(join(root, 'src/added file.ts'), 'export const b = 1;\n');

    const result = await runDiffRefresh(root);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines).toEqual(expect.arrayContaining(['src/new name.ts', 'src/added file.ts']));
    expect(lines).not.toContain('src/old name.ts');
    expect(result.stdout).not.toContain('"');
  });

  it('measures the branch from master when the repository has no main', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/base.ts'), 'export const base = 1;\n');
    git(root, ['init', '-q', '-b', 'master']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'base']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    writeFileSync(join(root, 'src/branch.ts'), 'export const branch = 1;\n');
    git(root, ['add', 'src/branch.ts']);
    git(root, ['commit', '-q', '-m', 'branch change']);

    const result = await runDiffRefresh(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Diff refresh for demo-project (1 changed files)');
    expect(result.stdout.split('\n')).toContain('src/branch.ts');
  });

  it('measures the branch from the default branch origin/HEAD names', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/base.ts'), 'export const base = 1;\n');
    git(root, ['init', '-q', '-b', 'trunk']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'base']);
    git(root, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
    git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    writeFileSync(join(root, 'src/branch.ts'), 'export const branch = 1;\n');
    git(root, ['add', 'src/branch.ts']);
    git(root, ['commit', '-q', '-m', 'branch change']);
    git(root, ['branch', '-q', '-D', 'trunk']);

    const result = await runDiffRefresh(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Diff refresh for demo-project (1 changed files)');
    expect(result.stdout.split('\n')).toContain('src/branch.ts');
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
