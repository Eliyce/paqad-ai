import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execaSync } from 'execa';
import { describe, expect, it, vi } from 'vitest';

import type { BackstopMutationDeps, MutationProfileFacts } from '@/mutation/backstop.js';
import { MUTATION_OFF_NOTE } from '@/mutation/backstop.js';
import type { VerificationOrigin } from '@/core/types/verification.js';
import { buildRepositoryVerificationContext } from '@/verification/repository/repository-context.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { ownInFlightChange } from '../shared.fixture.js';
import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';

type Origin = Extract<VerificationOrigin, 'hook-completion' | 'git-backstop' | 'ci-backstop'>;
const ORIGINS: Origin[] = ['hook-completion', 'git-backstop', 'ci-backstop'];

function makeProject(mode?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-mutation-wiring-'));
  mkdirSync(join(root, '.paqad/configs'), { recursive: true });
  if (mode !== undefined) {
    writeFileSync(join(root, '.paqad/configs/.config.policy'), `mutation_mode=${mode}\n`);
  }
  seedGitChangedFiles(root, ['src/feature.ts', 'tests/feature.test.ts']);
  return root;
}

function porcelain(root: string): string {
  return execaSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root }).stdout;
}

const stack = {
  frameworks: ['react'],
  traits: ['vite-spa'],
  toolchains: [],
  version_bands: [],
  sources: [],
};

function spies(test = 'pnpm test', testExit = 0) {
  const readProfile = vi.fn(
    () => ({ commands: { test }, stack_profile: stack }) as unknown as MutationProfileFacts,
  );
  const runTestCommand = vi.fn(async () => ({ exitCode: testExit }));
  const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
  const mutationDeps: BackstopMutationDeps = {
    readProfile,
    runTestCommand,
    snapshotTree: async () => 'same',
    runner: { detectTool: async () => true, execute, parse: async () => [] },
  };
  return { readProfile, runTestCommand, execute, mutationDeps };
}

async function verdictOn(root: string, origin: Origin, mutationDeps: BackstopMutationDeps) {
  if (origin === 'hook-completion') ownInFlightChange(root);
  const verdict = await runRepositoryVerification({ projectRoot: root, origin, mutationDeps });
  return {
    verdict,
    gate: verdict.gates.find((entry) => entry.gate === 'mutation-testing'),
  };
}

describe('mutation wiring: mode off or absent (disabled == missing)', () => {
  it('AC-17: nothing runs on any origin, the gate reads not required, the tree stays clean', async () => {
    const readings: string[] = [];
    for (const mode of ['off', undefined]) {
      for (const origin of ORIGINS) {
        const root = makeProject(mode);
        const { readProfile, runTestCommand, execute, mutationDeps } = spies();
        const before = porcelain(root);

        const { context } = await buildRepositoryVerificationContext({
          projectRoot: root,
          origin,
          mutationDeps,
        });
        expect(context.mutation_result).toBeUndefined();
        expect(context.mutation_strict).toBeUndefined();
        expect(context.mutation_note).toBe(MUTATION_OFF_NOTE);

        const { gate } = await verdictOn(root, origin, mutationDeps);
        expect(gate).toMatchObject({
          status: 'skipped',
          skip_kind: 'not-required',
          detail: MUTATION_OFF_NOTE,
        });
        expect(readProfile).not.toHaveBeenCalled();
        expect(runTestCommand).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(porcelain(root)).toBe(before);
        readings.push(`${origin}:${JSON.stringify(gate)}`);
      }
    }
    expect(readings.slice(0, ORIGINS.length)).toEqual(readings.slice(ORIGINS.length));
  }, 60_000);
});

describe('mutation wiring: the seams', () => {
  it('AC-21: strict on hook-completion runs nothing and reads not required, CI and pre-push only', async () => {
    const root = makeProject('strict');
    const { readProfile, runTestCommand, execute, mutationDeps } = spies();

    const { gate } = await verdictOn(root, 'hook-completion', mutationDeps);

    expect(gate?.status).toBe('skipped');
    expect(gate?.skip_kind).toBe('not-required');
    expect(gate?.detail).toBe(
      'Mutation testing runs only on CI and pre-push (mutation_mode is strict).',
    );
    expect(readProfile).not.toHaveBeenCalled();
    expect(runTestCommand).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('AC-22: a red test command reads did not run (tests not green) and never runs the tool', async () => {
    const root = makeProject('warn');
    const { runTestCommand, execute, mutationDeps } = spies('pnpm test', 1);

    const { gate } = await verdictOn(root, 'ci-backstop', mutationDeps);

    expect(runTestCommand).toHaveBeenCalledWith('pnpm test', root);
    expect(execute).not.toHaveBeenCalled();
    expect(gate?.status).toBe('skipped');
    expect(gate?.skip_kind).toBe('did-not-run');
    expect(gate?.detail).toContain('did not run');
    expect(gate?.detail).toContain('test command was not green');
  });

  it('AC-22: no test command reads did not run, naming the missing command', async () => {
    const root = makeProject('warn');
    const { runTestCommand, execute, mutationDeps } = spies('');

    const { gate } = await verdictOn(root, 'git-backstop', mutationDeps);

    expect(runTestCommand).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(gate?.skip_kind).toBe('did-not-run');
    expect(gate?.detail).toContain('no test command is configured');
  });

  it('AC-25: a run that leaves the tree dirty fails hard under warn and under strict', async () => {
    for (const mode of ['warn', 'strict']) {
      const root = makeProject(mode);
      const { mutationDeps } = spies();
      let snapshot = 0;
      mutationDeps.snapshotTree = async () => `tree-${snapshot++}`;

      const { verdict, gate } = await verdictOn(root, 'ci-backstop', mutationDeps);

      expect(gate?.status).toBe('fail');
      expect(gate?.detail).toContain('Working tree was not clean after the mutation run');
      expect(verdict.ok).toBe(false);
    }
  }, 60_000);
});
