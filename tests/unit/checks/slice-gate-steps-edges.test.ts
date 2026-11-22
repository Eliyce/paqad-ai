import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  defaultSliceGateSteps,
  scopeCommandToFiles,
  sliceTestArgv,
  type SliceCommandRunner,
} from '@/checks/slice-gate-steps.js';

import { commitAll, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';

const enforce = vi.hoisted(() => ({
  result: { blocking: false, violations: [] as Array<Record<string, unknown>> },
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/rule-scripts/enforce.js', () => ({
  enforceRuleScripts: async (options: Record<string, unknown>) => {
    enforce.calls.push(options);
    return enforce.result;
  },
}));

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  enforce.result = { blocking: false, violations: [] };
  enforce.calls = [];
});

function root(pkg?: unknown): string {
  const dir = makeEmptyRepo('main');
  roots.push(dir);
  if (pkg !== undefined) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

type Outcome = Awaited<ReturnType<SliceCommandRunner>>;

function recorder(answer: (argv: string[]) => Outcome) {
  const calls: string[] = [];
  const run: SliceCommandRunner = async (bin, args) => {
    const argv = [bin, ...args];
    calls.push(argv.join(' '));
    return answer(argv);
  };
  return { calls, run };
}

const OK: Outcome = { exitCode: 0, output: '', timedOut: false };

describe('scoping a project command to the slice files (AC-10)', () => {
  it('AC-10 replaces the files token, expands yarn and pass-through scripts and refuses the rest', () => {
    const dir = root({ scripts: { lint: 'eslint .', fix: 'eslint --fix .', bad: 3 } });
    expect(scopeCommandToFiles(dir, 'eslint {files} --cache', ['a.ts', 'b.ts'])).toEqual([
      'eslint',
      'a.ts',
      'b.ts',
      '--cache',
    ]);
    expect(scopeCommandToFiles(dir, 'yarn lint', ['a.ts'])).toEqual(['yarn', 'eslint', 'a.ts']);
    expect(scopeCommandToFiles(dir, 'pnpm run lint -- --quiet', ['a.ts'])).toEqual([
      'pnpm',
      'exec',
      'eslint',
      '--quiet',
      'a.ts',
    ]);
    expect(scopeCommandToFiles(dir, 'npm run-script fix --cache', ['a.ts'])).toEqual([
      'npm',
      'exec',
      '--',
      'eslint',
      '--fix',
      '--cache',
      'a.ts',
    ]);
    expect(scopeCommandToFiles(dir, 'eslint .', [])).toBeNull();
    expect(scopeCommandToFiles(dir, '', ['a.ts'])).toBeNull();
    expect(scopeCommandToFiles(dir, 'eslint . && tsc', ['a.ts'])).toBeNull();
    expect(scopeCommandToFiles(dir, 'pnpm', ['a.ts'])).toBeNull();
    expect(scopeCommandToFiles(dir, 'pnpm exec eslint', ['a.ts'])).toBeNull();
    expect(scopeCommandToFiles(dir, 'pnpm bad', ['a.ts'])).toBeNull();
    expect(scopeCommandToFiles(dir, 'pnpm missing', ['a.ts'])).toBeNull();
  });

  it('AC-10 treats a missing, unreadable or script-free package.json as no scripts', () => {
    expect(scopeCommandToFiles(root(), 'pnpm lint', ['a.ts'])).toBeNull();
    expect(scopeCommandToFiles(root({}), 'pnpm lint', ['a.ts'])).toBeNull();
    const broken = root();
    writeFileSync(join(broken, 'package.json'), '{oops');
    expect(scopeCommandToFiles(broken, 'pnpm lint', ['a.ts'])).toBeNull();
  });

  it('AC-10 builds no test command without test files, a test command or a single command', () => {
    const dir = root();
    const profile = (commands: Record<string, string | undefined>) => ({ commands }) as never;
    expect(sliceTestArgv(dir, profile({ test: 'node' }), [])).toBeNull();
    expect(sliceTestArgv(dir, profile({}), ['a.test.ts'])).toBeNull();
    expect(sliceTestArgv(dir, profile({ test: 'a && b' }), ['a.test.ts'])).toBeNull();
    expect(
      sliceTestArgv(dir, profile({ test_single: 'jest <path_or_file>' }), ['a.test.ts']),
    ).toEqual(['jest', 'a.test.ts', '--maxWorkers=2']);
  });
});

describe('slice gate steps on failure and edge paths (AC-2, AC-10)', () => {
  it('AC-10 skips every step without a profile or owned files', async () => {
    const dir = root();
    const { calls, run } = recorder(() => OK);
    const none = defaultSliceGateSteps({ projectRoot: dir, deadlineMs: 1_000, run, profile: null });
    expect(await none.format(['a.ts'], [])).toEqual([]);
    expect(await none.lint(['a.ts'], [])).toEqual([]);
    expect(await none.typecheck(['a.ts'], [])).toEqual([]);
    expect(await none.tests(['a.ts'], ['a.test.ts'])).toEqual([]);
    expect(await none.rules([], [])).toEqual([]);
    const steps = defaultSliceGateSteps({
      projectRoot: dir,
      deadlineMs: 1_000,
      run,
      profile: {
        commands: { format: 'prettier --write .', lint: 'eslint .', test: 'node' },
      } as never,
    });
    expect(await steps.format(['missing.ts'], [])).toEqual([]);
    expect(await steps.lint(['missing.ts'], [])).toEqual([]);
    expect(await steps.typecheck(['missing.ts'], [])).toEqual([]);
    expect(await steps.tests([], ['missing.test.ts'])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('AC-10 reports format and lint failures and skips commands that cannot be scoped', async () => {
    const dir = root();
    writeRepoFile(dir, 'src/a.ts', 'x');
    const { calls, run } = recorder(() => ({
      exitCode: 4,
      output: 'one\n\n two \nthree',
      timedOut: false,
    }));
    const steps = defaultSliceGateSteps({
      projectRoot: dir,
      deadlineMs: 1_000,
      nowMs: () => 0,
      run,
      profile: { commands: { format: 'prettier --write .', lint: 'eslint .' } } as never,
    });
    expect(await steps.format(['src/a.ts'], [])).toEqual([
      'format: `prettier --write src/a.ts` exited 4: one | two | three',
    ]);
    expect(await steps.lint(['src/a.ts'], [])).toEqual([
      'lint: `eslint src/a.ts` exited 4: one | two | three',
    ]);
    const unscoped = defaultSliceGateSteps({
      projectRoot: dir,
      deadlineMs: 1_000,
      run,
      profile: { commands: { format: 'make fmt', lint: 'make lint' } } as never,
    });
    expect(await unscoped.format(['src/a.ts'], [])).toEqual([]);
    expect(await unscoped.lint(['src/a.ts'], [])).toEqual([]);
    expect(calls).toEqual(['prettier --write src/a.ts', 'eslint src/a.ts']);
  });

  it('AC-10 formats only the changed files through the stack pack formatter', async () => {
    const dir = root({ scripts: { format: 'prettier --write .' } });
    commitAll(dir, 'base');
    writeRepoFile(dir, 'src/a.ts', 'x');
    const { calls, run } = recorder(() => OK);
    const steps = defaultSliceGateSteps({
      projectRoot: dir,
      deadlineMs: 1_000,
      run,
      profile: {
        commands: { format: 'pnpm format' },
        stack_profile: { frameworks: ['react'] },
      } as never,
    });
    expect(await steps.format(['src/a.ts'], [])).toEqual([]);
    expect(calls).toEqual(['pnpm exec prettier --write --ignore-unknown ./src/a.ts']);
    const fallback = recorder(() => OK);
    const other = defaultSliceGateSteps({
      projectRoot: dir,
      deadlineMs: 1_000,
      run: fallback.run,
      profile: {
        commands: { format: 'pnpm format' },
        stack_profile: { frameworks: ['no-such-stack'] },
      } as never,
    });
    expect(await other.format(['src/a.ts'], [])).toEqual([]);
    expect(fallback.calls).toEqual(['pnpm exec prettier --write src/a.ts']);
  });

  it('AC-10 AC-34 judges typecheck by its mapped command, owned errors and the time limit', async () => {
    const dir = root({ scripts: { typecheck: 'tsc --noEmit' } });
    writeRepoFile(dir, 'src/a.ts', 'x');
    let answer: Outcome = OK;
    const { calls, run } = recorder(() => answer);
    const steps = (commands: Record<string, string>) =>
      defaultSliceGateSteps({
        projectRoot: dir,
        deadlineMs: 1_000,
        run,
        profile: { commands } as never,
      });
    expect(await steps({ typecheck: ' tsc -b ' }).typecheck(['src/a.ts'], [])).toEqual([]);
    expect(await steps({ typecheck: 'tsc && tsc' }).typecheck(['src/a.ts'], [])).toEqual([]);
    answer = { exitCode: 0, output: '', timedOut: true };
    expect(await steps({ test: 'make test' }).typecheck(['src/a.ts'], [])).toEqual([
      'typecheck: `npm run typecheck` was stopped at the slice gate time limit',
    ]);
    answer = { exitCode: 2, output: 'tsconfig.json is broken', timedOut: false };
    expect(await steps({}).typecheck(['src/a.ts'], [])).toEqual([
      'typecheck: `npm run typecheck` exited 2: tsconfig.json is broken',
    ]);
    expect(calls).toEqual(['tsc -b', 'npm run typecheck', 'npm run typecheck']);
    const bare = root({ scripts: {} });
    writeRepoFile(bare, 'src/a.ts', 'x');
    const noScript = defaultSliceGateSteps({
      projectRoot: bare,
      deadlineMs: 1_000,
      run,
      profile: { commands: {} } as never,
    });
    expect(await noScript.typecheck(['src/a.ts'], [])).toEqual([]);
  });

  it('AC-10 keeps a failing exit code when a step also hits the time limit and passes a green test run', async () => {
    const dir = root();
    writeRepoFile(dir, 'tests/a.test.ts', 'x');
    let answer: Outcome = { exitCode: 9, output: '', timedOut: true };
    const { run } = recorder(() => answer);
    const steps = defaultSliceGateSteps({
      projectRoot: dir,
      deadlineMs: Date.now() + 60_000,
      run,
      profile: { commands: { test: 'node' } } as never,
    });
    expect(await steps.tests([], ['tests/a.test.ts'])).toEqual([
      'tests: `node tests/a.test.ts` was stopped at the slice gate time limit',
    ]);
    answer = OK;
    expect(await steps.tests([], ['tests/a.test.ts'])).toEqual([]);
  });

  it('AC-10 reports blocking rule violations on the owned files only', async () => {
    const dir = root();
    const steps = defaultSliceGateSteps({ projectRoot: dir, deadlineMs: 1_000, profile: null });
    expect(await steps.rules(['src/a.ts'], [])).toEqual([]);
    enforce.result = {
      blocking: true,
      violations: [
        { rule_id: 'R-1', file: 'src/a.ts', line: 3, message: 'no' },
        { rule_id: 'R-2', file: 'src/a.ts', message: 'never' },
      ],
    };
    expect(await steps.rules(['src/a.ts'], [])).toEqual([
      'rules: R-1 src/a.ts:3 no',
      'rules: R-2 src/a.ts never',
    ]);
    expect(enforce.calls[0]).toMatchObject({
      scope: 'changed-files',
      changedFiles: ['src/a.ts'],
    });
  });
});

describe('slice gate default command runner (AC-10)', () => {
  it('AC-10 runs the real command without the paqad session variables', async () => {
    const dir = root();
    writeRepoFile(
      dir,
      'tests/env.test.mjs',
      'process.exit(process.env.SE_SESSION || process.env.SE_AGENT_ID ? 5 : 0);\n',
    );
    vi.stubEnv('SE_SESSION', 'leak');
    vi.stubEnv('SE_AGENT_ID', 'leak');
    try {
      const steps = defaultSliceGateSteps({
        projectRoot: dir,
        deadlineMs: Date.now() + 60_000,
        profile: { commands: { test: 'node' } } as never,
      });
      expect(await steps.tests([], ['tests/env.test.mjs'])).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('AC-10 turns a missing binary and an unspawnable argument into a failed step', async () => {
    const dir = root();
    writeRepoFile(dir, 'tests/a.test.mjs', 'x');
    const steps = (test: string) =>
      defaultSliceGateSteps({
        projectRoot: dir,
        deadlineMs: Date.now() + 60_000,
        profile: { commands: { test } } as never,
      });
    const [missing] = await steps('paqad-no-such-binary-xyz').tests([], ['tests/a.test.mjs']);
    expect(missing).toMatch(/^tests: `paqad-no-such-binary-xyz tests\/a\.test\.mjs` exited 1: /);
    const [nul] = await steps('node a\0b').tests([], ['tests/a.test.mjs']);
    expect(nul).toMatch(/null bytes/);
  });
});
