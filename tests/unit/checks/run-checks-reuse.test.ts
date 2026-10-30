import { existsSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runChecks } from '@/checks/run-checks.js';
import type { RunChecksOptions } from '@/checks/run-checks.js';
import { readRunHistory, runHistoryPath } from '@/checks/run-history.js';
import { computeTreeIdentityResult } from '@/checks/tree-identity.js';
import { renderReceipt } from '@/cli/commands/checks.js';
import type { DeliveryShell } from '@/delivery/runner.js';

import { commitAll, initGitRepo, writeRepoFile } from '../_helpers/git-repo.js';
import { useTempRoots } from '../_helpers/temp-roots.js';

const GiB = 1024 ** 3;
const TAP_GREEN = 'TAP version 13\nok 1 - works\nok 2 - also works\n1..2\n';
const TAP_RED = 'TAP version 13\nok 1 - works\nnot ok 2 - broken\n1..2\n';

interface FakeShell extends DeliveryShell {
  calls: string[];
}

function fakeShell(
  root: string,
  behaviour: { test?: string; testExit?: number; build?: () => void } = {},
): FakeShell {
  const calls: string[] = [];
  return {
    calls,
    async run(bin, args) {
      const line = [bin, ...args].join(' ');
      calls.push(line);
      if (line.startsWith('pnpm build')) {
        (behaviour.build ?? (() => writeRepoFile(root, 'dist/index.js', 'built\n')))();
      }
      if (line.startsWith('pnpm test')) {
        return {
          stdout: behaviour.test ?? TAP_GREEN,
          stderr: '',
          exitCode: behaviour.testExit ?? 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
}

function profile(
  commands: Record<string, string>,
  frameworks = 'react',
  extra: string[] = [],
): string {
  return (
    [
      'commands:',
      ...Object.entries(commands).map(([key, value]) => `  ${key}: ${value}`),
      'stack_profile:',
      `  frameworks: [${frameworks}]`,
      '  traits: [vitest]',
      '  languages: []',
      '  runtimes: []',
      ...extra,
    ].join('\n') + '\n'
  );
}

const COMMANDS = {
  format: 'pnpm format',
  test: 'pnpm test -- --reporter=tap',
  build: 'pnpm build',
};

describe('runChecks reuse of a green run on the same tree', () => {
  const makeRoot = useTempRoots('paqad-reuse-');

  function project(commands: Record<string, string> = COMMANDS, frameworks = 'react'): string {
    const root = makeRoot();
    initGitRepo(root, {
      '.gitignore': 'dist/\nignored/\n.paqad/checks/\n',
      'src/app.ts': 'export const app = 1;\n',
      'src/other.ts': 'export const other = 1;\n',
      '.paqad/scripts/tool.sh': 'echo tool\n',
      '.paqad/configs/a.yaml': 'a: 1\n',
      '.paqad/project-profile.yaml': profile(commands, frameworks),
      'dist/index.js': 'built\n',
    });
    commitAll(root);
    return root;
  }

  let clock = 0;
  async function run(root: string, shell: FakeShell, extra: Partial<RunChecksOptions> = {}) {
    return runChecks({
      projectRoot: root,
      shell,
      osFacts: { availableParallelism: 8, totalmem: 64 * GiB },
      now: () => `2026-10-30T10:${String(clock++ % 60).padStart(2, '0')}:00.000Z`,
      nowMs: () => clock * 1000,
      nodeVersion: 'v22.0.0',
      ...extra,
    });
  }

  async function seedGreen(root: string): Promise<void> {
    const first = await run(root, fakeShell(root));
    expect(first.passed).toBe(true);
    expect(first.reused).toBe(0);
  }

  function ranFor(shell: FakeShell, prefix: string): boolean {
    return shell.calls.some((call) => call.startsWith(prefix));
  }

  async function expectReal(root: string): Promise<void> {
    const shell = fakeShell(root);
    const result = await run(root, shell);
    expect(result.reused).toBe(0);
    expect(ranFor(shell, 'pnpm build')).toBe(true);
    expect(ranFor(shell, 'pnpm test')).toBe(true);
  }

  async function expectReused(root: string): Promise<void> {
    const shell = fakeShell(root);
    const result = await run(root, shell);
    expect(result.reused).toBe(2);
    expect(ranFor(shell, 'pnpm build')).toBe(false);
    expect(ranFor(shell, 'pnpm test')).toBe(false);
  }

  it('reuses build and test on an unchanged tree, still runs format, and prints one reused line each', async () => {
    const root = project();
    const first = await run(root, fakeShell(root), { changedFiles: ['src/app.ts'] });
    const firstTest = first.commands.find((command) => command.logical_command === 'test')!;

    const shell = fakeShell(root);
    const second = await run(root, shell, { changedFiles: ['src/other.ts'] });

    expect(shell.calls).toEqual(['pnpm format']);
    expect(second.passed).toBe(true);
    expect(second.reused).toBe(2);
    const reused = second.commands.filter((command) => command.outcome === 'reused');
    expect(reused.map((command) => command.logical_command)).toEqual(['test', 'build']);
    for (const command of reused) {
      expect(command.duration_ms).toBe(0);
      expect(command.passed).toBe(true);
      expect(command.exit_code).toBe(0);
      expect(command.tree_digest).toBe(second.tree?.digest);
    }
    expect(reused[0]?.reused_from).toBe(firstTest.started_at);
    expect(second.test_total).toBe(2);
    expect(second.test_result?.summary.total).toBe(2);
    expect(second.test_result?.evidence_scope).toEqual({ related_paths: ['src/other.ts'] });
    expect(second.results).toHaveLength(3);
    expect(second.tree?.digest).toBe(first.tree?.digest);

    const lines = renderReceipt(second, 'warn');
    const at = new Date(firstTest.started_at);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    expect(lines).toContain(
      `> - 🟢 reused green test run from ${hhmm} (same files, same command): 2 tests`,
    );
    expect(lines.filter((line) => line.includes('reused green build run from'))).toHaveLength(1);
    expect(lines.some((line) => line.includes('format passed'))).toBe(true);
  });

  it('runs for real after a tracked edit, a new untracked file or a deleted tracked file', async () => {
    const root = project();
    await seedGreen(root);
    writeRepoFile(root, 'src/app.ts', 'export const app = 2;\n');
    await expectReal(root);
    await expectReused(root);
    writeRepoFile(root, 'src/new.ts', 'x\n');
    await expectReal(root);
    rmSync(join(root, 'src/other.ts'));
    await expectReal(root);
  });

  it('reuses when only ignored files or paqad record folders changed, not when .paqad/scripts changed', async () => {
    const root = project();
    await seedGreen(root);
    writeRepoFile(root, 'ignored/x.txt', 'x\n');
    for (const dir of ['.paqad/ledger', '.paqad/traceability', '.paqad/decisions']) {
      writeRepoFile(root, `${dir}/note.json`, '{}\n');
    }
    await expectReused(root);
    writeRepoFile(root, '.paqad/scripts/tool.sh', 'echo changed\n');
    await expectReal(root);
    await expectReused(root);
    writeRepoFile(root, '.paqad/configs/a.yaml', 'a: 2\n');
    await expectReal(root);
  });

  it('runs for real when the newest run of a command failed, even with an older green run', async () => {
    const root = project();
    await seedGreen(root);
    const red = await run(root, fakeShell(root, { test: TAP_RED, testExit: 1 }), { reuse: false });
    expect(red.passed).toBe(false);
    await expectReal(root);
  });

  it('runs for real when the newest run of a command is on another tree', async () => {
    const root = project();
    await seedGreen(root);
    writeRepoFile(root, 'src/app.ts', 'export const app = 2;\n');
    await seedGreen(root);
    writeRepoFile(root, 'src/app.ts', 'export const app = 1;\n');
    await expectReal(root);
  });

  it('records an inconclusive test run as not reusable', async () => {
    const root = project();
    const result = await run(root, fakeShell(root, { test: 'TAP version 13\n1..0\n' }));
    expect(result.commands.find((c) => c.logical_command === 'test')?.outcome).toBe('inconclusive');
    const rows = readRunHistory(root);
    expect(rows.find((row) => row.logical_command === 'test')?.reusable).toBe(false);
    expect(rows.find((row) => row.logical_command === 'build')?.reusable).toBe(true);
    await expectReal(root);
  });

  it('marks a run whose tree moved while it ran as not reusable and reports the tree after the run', async () => {
    const root = project();
    const before = await run(
      root,
      fakeShell(root, { build: () => writeRepoFile(root, 'src/gen.ts', 'g\n') }),
    );
    expect(readRunHistory(root).every((row) => row.reusable === false)).toBe(true);
    const rowDigest = readRunHistory(root)[0]?.tree_digest;
    expect(before.tree?.digest).not.toBe(rowDigest);
    expect(before.commands.find((c) => c.logical_command === 'build')?.tree_digest).toBe(rowDigest);
    await expectReal(root);
  });

  it('reports no tree and records nothing reusable when the identity fails after the run', async () => {
    const root = project();
    let calls = 0;
    const result = await run(root, fakeShell(root), {
      treeIdentity: (projectRoot) =>
        calls++ === 0
          ? computeTreeIdentityResult(projectRoot)
          : { identity: null, reason: 'git is not installed' },
    });
    expect(result.tree).toBeNull();
    expect(result.tree_unavailable_reason).toBe('git is not installed');
    expect(readRunHistory(root).length).toBe(2);
    expect(readRunHistory(root).every((row) => !row.reusable)).toBe(true);
    await expectReal(root);
  });

  it('runs for real on a different Node version, command string or lockfile hash', async () => {
    const root = project();
    await seedGreen(root);
    const node = fakeShell(root);
    expect((await run(root, node, { nodeVersion: 'v20.0.0' })).reused).toBe(0);
    await seedGreen(root);

    writeRepoFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
    writeRepoFile(root, '.gitignore', 'dist/\nignored/\n.paqad/checks/\npnpm-lock.yaml\n');
    commitAll(root);
    await seedGreen(root);
    await expectReused(root);
    writeRepoFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\nchanged: true\n');
    await expectReal(root);
  });

  it('never shares a row between pnpm test and pnpm test:coverage', async () => {
    const root = project();
    await seedGreen(root);
    writeRepoFile(
      root,
      '.paqad/project-profile.yaml',
      profile({ ...COMMANDS, test: 'pnpm test:coverage -- --reporter=tap' }),
    );
    commitAll(root);
    const shell = fakeShell(root);
    const result = await run(root, shell);
    expect(result.reused).toBe(0);
    expect(shell.calls).toContain('pnpm test:coverage -- --reporter=tap');
  });

  it('runs build and test for real when build would be reusable but test would not', async () => {
    const root = project();
    await run(root, fakeShell(root, { test: 'TAP version 13\n1..0\n' }));
    const shell = fakeShell(root);
    const result = await run(root, shell);
    expect(result.reused).toBe(0);
    expect(result.commands.some((command) => command.outcome === 'reused')).toBe(false);
    expect(ranFor(shell, 'pnpm build')).toBe(true);
  });

  it('runs build and test for real when the build output changed or is missing', async () => {
    const root = project();
    await seedGreen(root);
    writeRepoFile(root, 'dist/index.js', 'built differently\n');
    await expectReal(root);
    await expectReused(root);
    const later = new Date('2030-01-01T00:00:00.000Z');
    utimesSync(join(root, 'dist/index.js'), later, later);
    await expectReal(root);
    await expectReused(root);
    rmSync(join(root, 'dist'), { recursive: true });
    const shell = fakeShell(root, { build: () => undefined });
    expect((await run(root, shell)).reused).toBe(0);
    expect((await run(root, fakeShell(root, { build: () => undefined }))).reused).toBe(0);
  });

  it('runs build for real when the pack declares no build output, but a test-only project reuses', async () => {
    const withBuild = project(COMMANDS, 'vue');
    await seedGreen(withBuild);
    await expectReal(withBuild);

    const testOnly = project({ test: COMMANDS.test }, 'vue');
    await run(testOnly, fakeShell(testOnly));
    const shell = fakeShell(testOnly);
    const result = await run(testOnly, shell);
    expect(result.reused).toBe(1);
    expect(shell.calls).toEqual([]);
  });

  it('runs for real when the snapshot behind the history row is gone', async () => {
    const root = project();
    await seedGreen(root);
    const [row] = readRunHistory(root);
    rmSync(join(root, row!.report_path));
    await expectReal(root);
  });

  it('--no-reuse runs everything for real and still records rows a later run reuses', async () => {
    const root = project();
    await seedGreen(root);
    const rowsBefore = readRunHistory(root).length;
    const shell = fakeShell(root);
    const forced = await run(root, shell, { reuse: false });
    expect(forced.reused).toBe(0);
    expect(ranFor(shell, 'pnpm test')).toBe(true);
    expect(readRunHistory(root).length).toBe(rowsBefore + 2);
    await expectReused(root);
  });

  it('runs every command for real outside git and says why there is no tree', async () => {
    const root = makeRoot();
    writeRepoFile(root, '.paqad/project-profile.yaml', profile(COMMANDS));
    for (let index = 0; index < 2; index += 1) {
      const shell = fakeShell(root);
      const result = await run(root, shell);
      expect(result.tree).toBeNull();
      expect(result.tree_unavailable_reason).toBe('not a git repository');
      expect(ranFor(shell, 'pnpm test')).toBe(true);
    }
    expect(existsSync(runHistoryPath(root))).toBe(false);
  });

  it('runs format and lint before the identity even when the policy lists them later', async () => {
    const root = project();
    const order: string[] = [];
    const shell = fakeShell(root);
    const tracked: FakeShell = {
      calls: shell.calls,
      async run(bin, args) {
        order.push(`${bin} ${args[0] ?? ''}`.trim());
        return shell.run(bin, args);
      },
    };
    const result = await run(root, tracked, {
      checksParallel: false,
      treeIdentity: (projectRoot) => {
        order.push('identity');
        return { identity: null, reason: `fixed for ${projectRoot.length > 0 ? 'test' : ''}` };
      },
    });
    expect(order.indexOf('pnpm format')).toBeLessThan(order.indexOf('identity'));
    expect(order.indexOf('identity')).toBeLessThan(order.indexOf('pnpm test'));
    expect(result.tree_unavailable_reason).toBe('fixed for test');
  });

  it('keeps going and warns when the run cannot be recorded', async () => {
    const root = project();
    writeRepoFile(root, '.paqad/checks/runs', 'not a folder');
    const result = await run(root, fakeShell(root));
    expect(result.passed).toBe(true);
    expect(
      result.warnings.some((warning) => warning.includes('could not record this checks run')),
    ).toBe(true);
    expect(readFileSync(join(root, '.paqad/checks/runs'), 'utf8')).toBe('not a folder');
  });
});
