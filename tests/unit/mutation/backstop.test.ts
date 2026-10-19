import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execaSync } from 'execa';
import { describe, expect, it, vi } from 'vitest';

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { MutationResult, RawMutant } from '@/core/types/mutation.js';
import {
  MUTATION_OFF_NOTE,
  mutationSeamNote,
  runBackstopMutation,
  type BackstopMutationDeps,
  type MutationProfileFacts,
} from '@/mutation/backstop.js';
import { runMutationGate, type MutationRunnerDeps } from '@/mutation/runner.js';

// Issue #293 (Option A) — the backstop seam that is runMutationGate's only caller. Every external
// effect is injected, so no test here spawns a mutation tool.

function tsStack(): DetectedStackProfile {
  return {
    frameworks: ['react'],
    traits: ['vite-spa'],
    toolchains: [],
    version_bands: [],
    sources: [],
  };
}

function profile(test: string, stack: DetectedStackProfile | null = tsStack()) {
  return {
    commands: { test },
    stack_profile: stack ?? undefined,
  } as unknown as MutationProfileFacts;
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-mutation-backstop-'));
}

const SURVIVOR: RawMutant = {
  file: 'src/a.ts',
  line: 4,
  operator: 'ConditionalExpression',
  status: 'survived',
};

function runnerDeps(overrides: Partial<MutationRunnerDeps> = {}): MutationRunnerDeps {
  return {
    detectTool: async () => true,
    execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    parse: async () => [SURVIVOR],
    isTreeClean: async () => true,
    ...overrides,
  };
}

interface Spies {
  readProfile: ReturnType<typeof vi.fn>;
  runTestCommand: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
}

function spiedDeps(
  mode: 'off' | 'warn' | 'strict',
  overrides: Partial<BackstopMutationDeps> = {},
): { deps: BackstopMutationDeps; spies: Spies } {
  const spies: Spies = {
    readProfile: vi.fn(() => profile('pnpm test')),
    runTestCommand: vi.fn(async () => ({ exitCode: 0 })),
    runMutation: vi.fn((options: Parameters<typeof runMutationGate>[0]) =>
      runMutationGate({ ...options, deps: { ...options.deps, ...runnerDeps() } }),
    ),
  };
  return {
    spies,
    deps: {
      resolveMode: () => mode,
      readProfile: spies.readProfile,
      runTestCommand: spies.runTestCommand,
      runMutation: spies.runMutation,
      snapshotTree: async () => 'same',
      ...overrides,
    },
  };
}

describe('runBackstopMutation — when nothing runs', () => {
  it('AC-17: mode off plants only the off note and calls nothing', async () => {
    const { deps, spies } = spiedDeps('off');
    for (const origin of ['hook-completion', 'git-backstop', 'ci-backstop'] as const) {
      const outcome = await runBackstopMutation({
        projectRoot: tempRoot(),
        origin,
        changedFiles: ['src/a.ts'],
        lane: 'full',
        deps,
      });
      expect(outcome).toEqual({ mutation_note: MUTATION_OFF_NOTE });
    }
    expect(spies.readProfile).not.toHaveBeenCalled();
    expect(spies.runTestCommand).not.toHaveBeenCalled();
    expect(spies.runMutation).not.toHaveBeenCalled();
  });

  it('AC-17: the key absent from every surface resolves to off (disabled == missing)', async () => {
    const outcome = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
    });
    expect(outcome).toEqual({ mutation_note: MUTATION_OFF_NOTE });
  });

  it('AC-21: strict on hook-completion runs neither the test command nor runMutationGate', async () => {
    const { deps, spies } = spiedDeps('strict');
    const outcome = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'hook-completion',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps,
    });
    expect(outcome).toEqual({ mutation_note: mutationSeamNote('strict') });
    expect(outcome.mutation_note).toContain('only on CI and pre-push');
    expect(spies.readProfile).not.toHaveBeenCalled();
    expect(spies.runTestCommand).not.toHaveBeenCalled();
    expect(spies.runMutation).not.toHaveBeenCalled();
  });

  it('skips the suite on the fast lane and when no code changed', async () => {
    const { deps, spies } = spiedDeps('warn');
    const fast = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'fast',
      deps,
    });
    expect(fast.mutation_result?.skipped_reason).toBe('fast-lane');
    const docsOnly = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'git-backstop',
      changedFiles: ['docs/readme.md', 'src/a.test.ts'],
      lane: 'full',
      deps,
    });
    expect(docsOnly.mutation_result?.skipped_reason).toBe('no-changed-code');
    expect(docsOnly.mutation_result?.tool).toBe('stryker');
    expect(spies.runTestCommand).not.toHaveBeenCalled();
    expect(spies.runMutation).not.toHaveBeenCalled();
  });
});

describe('runBackstopMutation — the green-suite signal', () => {
  it('AC-22: a red test command reads tests-not-green and never starts the runner', async () => {
    const { deps, spies } = spiedDeps('warn', {
      runTestCommand: vi.fn(async () => ({ exitCode: 1 })),
    });
    const outcome = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps,
    });
    expect(outcome.mutation_result).toMatchObject({
      status: 'skipped',
      skipped_reason: 'tests-not-green',
    });
    expect(outcome.mutation_strict).toBe(false);
    expect(spies.runMutation).not.toHaveBeenCalled();
  });

  it('AC-22: no test command reads no-test-command and never runs anything', async () => {
    const { deps, spies } = spiedDeps('strict', { readProfile: vi.fn(() => profile('  ')) });
    const outcome = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'git-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps,
    });
    expect(outcome.mutation_result?.skipped_reason).toBe('no-test-command');
    expect(outcome.mutation_strict).toBe(true);
    expect(spies.runTestCommand).not.toHaveBeenCalled();
    expect(spies.runMutation).not.toHaveBeenCalled();
  });

  it('a green suite threads the profile stack, lane and changed files into runMutationGate', async () => {
    const { deps, spies } = spiedDeps('strict');
    const outcome = await runBackstopMutation({
      projectRoot: '/repo',
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'graduated',
      deps,
    });
    expect(spies.runTestCommand).toHaveBeenCalledWith('pnpm test', '/repo');
    expect(spies.runMutation).toHaveBeenCalledTimes(1);
    expect(spies.runMutation.mock.calls[0]![0]).toMatchObject({
      projectRoot: '/repo',
      changedFiles: ['src/a.ts'],
      lane: 'graduated',
      stackProfile: tsStack(),
      testsGreen: true,
    });
    expect(outcome.mutation_result?.status).toBe('survivors');
    expect(outcome.mutation_strict).toBe(true);
  });

  it('detects the stack when the profile carries none', async () => {
    const detectStackProfile = vi.fn(async () => tsStack());
    const { deps } = spiedDeps('warn', {
      readProfile: () => profile('pnpm test', null),
      detectStackProfile,
    });
    const outcome = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps,
    });
    expect(detectStackProfile).toHaveBeenCalledTimes(1);
    expect(outcome.mutation_result?.tool).toBe('stryker');
  });

  it('never throws: a fault records a run-failed skip', async () => {
    const { deps } = spiedDeps('warn', {
      runTestCommand: async () => {
        throw new Error('spawn failed');
      },
    });
    const outcome = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps,
    });
    expect(outcome.mutation_result?.skipped_reason).toBe('run-failed');
    expect(outcome.mutation_result?.tool).toBe('stryker');
  });

  it('a non-Error throw is still a run-failed skip', async () => {
    const { deps } = spiedDeps('warn', {
      readProfile: () => {
        throw 'boom';
      },
    });
    const outcome = await runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps,
    });
    expect(outcome.mutation_result?.skipped_reason).toBe('run-failed');
    expect(outcome.mutation_result?.tool).toBeNull();
  });
});

describe('runBackstopMutation — tree safety', () => {
  async function runWithSnapshots(snapshots: string[], mode: 'warn' | 'strict') {
    const queue = [...snapshots];
    const { deps } = spiedDeps(mode, {
      snapshotTree: async () => queue.shift() ?? 'end',
      runMutation: (options) =>
        runMutationGate({
          ...options,
          deps: { ...runnerDeps({ isTreeClean: undefined }), ...options.deps },
        }),
    });
    return runBackstopMutation({
      projectRoot: tempRoot(),
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps,
    });
  }

  it('AC-25: a run that changes the tree is unsafe-tree under warn and strict', async () => {
    for (const mode of ['warn', 'strict'] as const) {
      const outcome = await runWithSnapshots(['before', 'after'], mode);
      expect(outcome.mutation_result?.status).toBe('unsafe-tree');
      expect(outcome.mutation_result?.tree_clean).toBe(false);
    }
  });

  it('a tree the run left exactly as it found it counts as clean', async () => {
    const outcome = await runWithSnapshots(['dirty-before', 'dirty-before'], 'warn');
    expect(outcome.mutation_result?.status).toBe('survivors');
    expect(outcome.mutation_result?.tree_clean).toBe(true);
  });

  it('AC-25: the default snapshot sees a mutant left in a real git tree', async () => {
    const root = tempRoot();
    const git = (args: string[]) => execaSync('git', args, { cwd: root });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@paqad.dev']);
    git(['config', 'user.name', 'paqad test']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'dirty.ts'), 'export const d = 1;\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'base']);
    // Already dirty before the run: not the run's doing.
    writeFileSync(join(root, 'dirty.ts'), 'export const d = 2;\n');

    const outcomeFor = async (leaveMutant: boolean): Promise<MutationResult | undefined> => {
      const outcome = await runBackstopMutation({
        projectRoot: root,
        origin: 'ci-backstop',
        changedFiles: ['src/a.ts'],
        lane: 'full',
        deps: {
          resolveMode: () => 'warn',
          readProfile: () => profile('pnpm test'),
          runTestCommand: async () => ({ exitCode: 0 }),
          runner: {
            detectTool: async () => true,
            execute: async () => {
              if (leaveMutant) writeFileSync(join(root, 'dirty.ts'), 'export const d = -2;\n');
              return { exitCode: 0, stdout: '', stderr: '' };
            },
            parse: async () => [],
          },
        },
      });
      return outcome.mutation_result;
    };

    expect((await outcomeFor(false))?.status).toBe('killed-all');
    expect((await outcomeFor(true))?.status).toBe('unsafe-tree');
  });
});

describe('runBackstopMutation — default effects', () => {
  it('runs the test command as an argv chain and reads its exit code', async () => {
    const root = tempRoot();
    const run = (test: string) =>
      runBackstopMutation({
        projectRoot: root,
        origin: 'ci-backstop',
        changedFiles: ['src/a.ts'],
        lane: 'full',
        deps: {
          resolveMode: () => 'warn',
          readProfile: () => profile(test),
          runMutation: async (options) => skippedFor(options.stackProfile),
          snapshotTree: async () => 'same',
        },
      });
    const skippedFor = (stack: DetectedStackProfile | null): MutationResult => ({
      tool: stack ? 'stryker' : null,
      language: null,
      confidence: 'mature',
      scoped_files: [],
      total_mutants: 0,
      killed: 0,
      survived: 0,
      equivalent_set_aside: 0,
      kill_rate: null,
      surviving_mutants: [],
      tree_clean: true,
      status: 'killed-all',
      skipped_reason: null,
    });

    expect((await run('node --version')).mutation_result?.status).toBe('killed-all');
    expect((await run('node ./no-such-script.mjs')).mutation_result?.skipped_reason).toBe(
      'tests-not-green',
    );
    // A shell operator the checks runner refuses is a red suite, never a shell run.
    expect((await run('node --version | cat')).mutation_result?.skipped_reason).toBe(
      'tests-not-green',
    );
  });

  it('reads the profile and detects the stack read-only when the project has no profile', async () => {
    const root = tempRoot();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }),
    );
    const outcome = await runBackstopMutation({
      projectRoot: root,
      origin: 'ci-backstop',
      changedFiles: ['src/a.ts'],
      lane: 'full',
      deps: { resolveMode: () => 'warn' },
    });
    expect(outcome.mutation_result?.skipped_reason).toBe('no-test-command');
    expect(outcome.mutation_result?.tool).toBe('stryker');
  });
});
