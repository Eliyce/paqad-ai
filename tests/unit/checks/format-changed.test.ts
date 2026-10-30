import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FORMAT_CHANGED_MAX_FILES,
  filterFormattableFiles,
  resolveFormatCommand,
} from '@/checks/format-changed.js';
import { runChecks } from '@/checks/run-checks.js';
import type { DeliveryShell } from '@/delivery/runner.js';

import { commitAll, initGitRepo, writeRepoFile } from '../_helpers/git-repo.js';
import { useTempRoots } from '../_helpers/temp-roots.js';

const PNPM_CHANGED = 'pnpm exec prettier --write --ignore-unknown {files}';

describe('changed-files format', () => {
  const makeRoot = useTempRoots('paqad-format-changed-');

  function project(script = 'prettier --write .'): string {
    const root = makeRoot();
    initGitRepo(root, {
      '.gitignore': 'ignored/\n.paqad/\n',
      'package.json': JSON.stringify({ name: 'x', scripts: { format: script } }),
      'src/mod.ts': 'export const a = 1;\n',
      'src/gone.ts': 'export const gone = 1;\n',
      'src/same.ts': 'export const same = 1;\n',
    });
    commitAll(root);
    return root;
  }

  function edit(root: string): void {
    writeRepoFile(root, 'src/mod.ts', 'export const a = 2;\n');
    writeRepoFile(root, 'src/new.ts', 'export const b = 1;\n');
    writeRepoFile(root, '-x.ts', 'export const c = 1;\n');
    writeRepoFile(root, 'a b.ts', 'export const d = 1;\n');
    writeRepoFile(root, 'ignored/skip.ts', 'export const e = 1;\n');
    rmSync(join(root, 'src/gone.ts'));
  }

  function resolve(root: string, formatCommand = 'pnpm format', frameworks = ['react']) {
    return resolveFormatCommand({ projectRoot: root, frameworks, formatCommand });
  }

  it('formats only the changed, existing, non-ignored files with ./ prefixes as separate arguments', async () => {
    const root = project();
    edit(root);
    writeRepoFile(
      root,
      '.paqad/project-profile.yaml',
      [
        'commands:',
        '  format: pnpm format',
        'stack_profile:',
        '  frameworks: [react]',
        '  traits: [vitest]',
        '  languages: []',
        '  runtimes: []',
      ].join('\n') + '\n',
    );
    const calls: { bin: string; args: string[] }[] = [];
    const shell: DeliveryShell = {
      async run(bin, args) {
        calls.push({ bin, args });
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const result = await runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * 1024 ** 3 },
      now: () => '2026-10-30T00:00:00.000Z',
      nowMs: () => 0,
    });
    expect(calls).toEqual([
      {
        bin: 'pnpm',
        args: [
          'exec',
          'prettier',
          '--write',
          '--ignore-unknown',
          './-x.ts',
          './a b.ts',
          './src/mod.ts',
          './src/new.ts',
        ],
      },
    ]);
    expect(result.commands[0]?.command).toBe(PNPM_CHANGED);
  });

  it('uses the npm entry for npm run format', async () => {
    const root = project();
    edit(root);
    const resolved = await resolve(root, 'npm run format');
    expect(resolved.scope).toBe('changed');
    expect(resolved.command).toBe('npx --no-install prettier --write --ignore-unknown {files}');
  });

  it.each([
    ['the profile command differs', 'pnpm run format', 'prettier --write .', ['react']],
    ['the script body differs', 'pnpm format', 'prettier --write src', ['react']],
    ['the script is another formatter', 'pnpm format', 'biome format --write .', ['react']],
    ['the pack declares no changed-files formatter', 'pnpm format', 'prettier --write .', ['vue']],
  ])('runs the full format command when %s', async (_, command, script, frameworks) => {
    const root = project(script);
    edit(root);
    const resolved = await resolve(root, command, frameworks);
    expect(resolved).toMatchObject({ command, files: null, scope: 'full' });
  });

  it('runs the full format command without a package.json', async () => {
    const root = project();
    rmSync(join(root, 'package.json'));
    expect((await resolve(root)).scope).toBe('full');
  });

  it('runs the full format command when nothing changed', async () => {
    const root = project();
    expect(await resolve(root)).toMatchObject({
      scope: 'full',
      reason: 'no changed files to format',
    });
  });

  it('runs the full format command when git cannot list the files', async () => {
    const root = makeRoot();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { format: 'prettier --write .' } }),
    );
    expect(await resolve(root)).toMatchObject({
      scope: 'full',
      reason: 'git could not list the changed files',
    });
  });

  it(`runs the full format command above ${FORMAT_CHANGED_MAX_FILES} files`, async () => {
    const root = project();
    mkdirSync(join(root, 'many'));
    for (let index = 0; index < FORMAT_CHANGED_MAX_FILES; index += 1) {
      writeFileSync(join(root, 'many', `f${index}.ts`), '1\n');
    }
    writeRepoFile(root, 'src/mod.ts', 'export const a = 3;\n');
    expect(await resolve(root)).toMatchObject({
      scope: 'full',
      reason: `more than ${FORMAT_CHANGED_MAX_FILES} changed files`,
    });
    rmSync(join(root, 'many/f0.ts'));
    expect((await resolve(root)).files).toHaveLength(FORMAT_CHANGED_MAX_FILES);
  });

  it('drops symlinks that leave the root and keeps ones that stay inside', () => {
    const root = project();
    const outside = join(makeRoot(), 'secret.ts');
    writeFileSync(outside, 'x\n');
    symlinkSync(outside, join(root, 'out-link.ts'));
    symlinkSync(join(root, 'src/mod.ts'), join(root, 'in-link.ts'));
    symlinkSync(join(root, 'src'), join(root, 'dir-link'));
    symlinkSync('..', join(root, 'up-link'));
    symlinkSync(join(root, 'missing.ts'), join(root, 'dangling.ts'));
    mkdirSync(join(root, 'folder'));
    expect(
      filterFormattableFiles(root, [
        'out-link.ts',
        'in-link.ts',
        'dir-link',
        'up-link',
        'dangling.ts',
        'folder',
        'src/mod.ts',
        'src\\mod.ts',
        '/etc/passwd',
        'C:/x.ts',
        '../outside.ts',
        'src/../src/mod.ts',
        'src/missing.ts',
      ]),
    ).toEqual(['in-link.ts', 'src/mod.ts']);
  });
});
