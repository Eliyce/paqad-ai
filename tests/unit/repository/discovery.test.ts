import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverRepositoryContext } from '@/repository/discovery.js';

function createProject(root: string, relativePath: string): void {
  const projectRoot = join(root, relativePath);
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'package.json'), '{}\n');
}

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

describe('discoverRepositoryContext', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('excludes dot entries, static non-project trees, and nested VCS boundaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-repository-discovery-'));
    roots.push(root);
    createProject(root, '.');
    createProject(root, 'real-app');

    for (const ignored of [
      '.claude/worktrees/nested',
      '.codex/project',
      '.github/tooling',
      'docs/site',
      'tests/fixture',
      'dist/output',
      'coverage/report',
      'vendor/package',
      'modules/generated',
    ]) {
      createProject(root, ignored);
    }

    createProject(root, 'nested-file');
    writeFileSync(join(root, 'nested-file', '.git'), 'gitdir: ../.git/worktrees/nested-file\n');
    createProject(root, 'nested-directory');
    mkdirSync(join(root, 'nested-directory', '.git'));

    const context = await discoverRepositoryContext(root);

    expect(context.projects.map((project) => project.root)).toEqual(['.', 'real-app']);
    expect(context.applications.map((application) => application.root)).toEqual(['.', 'real-app']);
    expect(context.ignored_paths).toEqual(
      expect.arrayContaining([
        '.claude',
        '.codex',
        '.github',
        'coverage',
        'dist',
        'docs',
        'modules',
        'nested-directory',
        'nested-file',
        'tests',
        'vendor',
      ]),
    );
  });

  it('excludes git-ignored directories and marker files but keeps tracked markers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-repository-discovery-git-'));
    roots.push(root);
    git(root, ['init']);
    createProject(root, '.');
    createProject(root, 'ignored-directory');
    createProject(root, 'info-excluded');
    createProject(root, 'ignored-marker');
    createProject(root, 'tracked-marker');
    writeFileSync(
      join(root, '.gitignore'),
      ['ignored-directory/', 'ignored-marker/package.json', 'tracked-marker/package.json'].join(
        '\n',
      ),
    );
    writeFileSync(join(root, '.git', 'info', 'exclude'), 'info-excluded/\n');
    git(root, ['add', '-f', 'tracked-marker/package.json']);

    const context = await discoverRepositoryContext(root);

    expect(context.projects.map((project) => project.root)).toEqual(['.', 'tracked-marker']);
    expect(context.ignored_paths).toEqual(
      expect.arrayContaining([
        '.git',
        '.gitignore',
        'ignored-directory',
        'ignored-marker/package.json',
        'info-excluded',
      ]),
    );
  });

  it('retains real projects and static fallback behavior outside a git checkout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-repository-discovery-nongit-'));
    roots.push(root);
    createProject(root, '.');
    createProject(root, 'real-app');
    createProject(root, '.hidden/project');
    createProject(root, 'docs/example');

    const context = await discoverRepositoryContext(root);

    expect(context.projects.map((project) => project.root)).toEqual(['.', 'real-app']);
    expect(context.primary_project_root).toBe('.');
  });
});
