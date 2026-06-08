import { execaCommand } from 'execa';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { RawMutant } from '@/core/types/mutation.js';
import { buildCommand, runMutationGate, type MutationRunnerDeps } from '@/mutation/runner.js';
import { selectMutationTool } from '@/mutation/adapter.js';

function tsStack(): DetectedStackProfile {
  return {
    frameworks: ['node-cli'],
    traits: ['typescript'],
    toolchains: [],
    version_bands: [],
    sources: [],
  };
}

function rustStack(): DetectedStackProfile {
  return { frameworks: [], traits: ['rust'], toolchains: [], version_bands: [], sources: [] };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-mutation-'));
}

const okRun = { exitCode: 0, stdout: '', stderr: '' };

function deps(overrides: Partial<MutationRunnerDeps> = {}): MutationRunnerDeps {
  return {
    detectTool: async () => true,
    execute: async () => okRun,
    parse: async () => [],
    isTreeClean: async () => true,
    ...overrides,
  };
}

describe('runMutationGate — skip paths', () => {
  it('skips on the fast lane', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'fast',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: deps(),
    });
    expect(result.status).toBe('skipped');
    expect(result.skipped_reason).toBe('fast-lane');
    expect(result.tool).toBe('stryker');
  });

  it('skips when the suite is not green', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: false,
      deps: deps(),
    });
    expect(result.skipped_reason).toBe('tests-not-green');
  });

  it('skips when no changed code is mutable', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['docs/x.md', 'tests/a.test.ts'],
      lane: 'graduated',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: deps(),
    });
    expect(result.skipped_reason).toBe('no-changed-code');
  });

  it('skips when the tool is not configured in the project', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: deps({ detectTool: async () => false }),
    });
    expect(result.skipped_reason).toBe('tool-not-configured');
    expect(result.scoped_files).toEqual(['src/a.ts']);
  });

  it('reports a null tool for the generic fallback', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'fast',
      stackProfile: {
        frameworks: [],
        traits: ['elixir'],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      testsGreen: true,
      deps: deps(),
    });
    expect(result.tool).toBeNull();
    expect(result.confidence).toBe('lower');
  });
});

describe('runMutationGate — run paths', () => {
  const mutants: RawMutant[] = [
    { file: 'src/a.ts', line: 1, operator: 'ConditionalExpression', status: 'killed' },
    { file: 'src/a.ts', line: 2, operator: 'ArithmeticOperator', status: 'survived' },
  ];

  it('computes the outcome from parsed mutants and asserts a clean tree', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: deps({ parse: async () => mutants }),
    });
    expect(result.status).toBe('survivors');
    expect(result.killed).toBe(1);
    expect(result.survived).toBe(1);
    expect(result.tree_clean).toBe(true);
  });

  it('records run-failed when execution throws', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: deps({
        execute: async () => {
          throw new Error('boom');
        },
      }),
    });
    expect(result.skipped_reason).toBe('run-failed');
  });

  it('records run-failed when the report cannot be interpreted', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: deps({ parse: async () => null }),
    });
    expect(result.skipped_reason).toBe('run-failed');
  });

  it('flags an unsafe tree when a mutant was left behind', async () => {
    const result = await runMutationGate({
      projectRoot: tempDir(),
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: deps({ parse: async () => mutants, isTreeClean: async () => false }),
    });
    expect(result.status).toBe('unsafe-tree');
  });
});

describe('buildCommand', () => {
  it('passes a --mutate glob list for Stryker', () => {
    const descriptor = selectMutationTool(tsStack());
    expect(buildCommand(descriptor, ['src/a.ts', 'src/b.ts'])).toBe(
      'npx stryker run --mutate "src/a.ts,src/b.ts"',
    );
  });

  it('passes files positionally for other tools', () => {
    const descriptor = selectMutationTool(rustStack());
    expect(buildCommand(descriptor, ['src/a.rs'])).toBe('cargo mutants src/a.rs');
  });
});

describe('default deps', () => {
  it('detects Stryker via a config marker', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'stryker.conf.json'), '{}');
    const result = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: { execute: async () => okRun, parse: async () => [], isTreeClean: async () => true },
    });
    // Detection passed → it ran (no tool-not-configured skip).
    expect(result.skipped_reason).not.toBe('tool-not-configured');
  });

  it('detects Stryker via a package.json devDependency', async () => {
    const root = tempDir();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ devDependencies: { '@stryker-mutator/core': '^8.0.0' } }),
    );
    const result = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: { execute: async () => okRun, parse: async () => [], isTreeClean: async () => true },
    });
    expect(result.skipped_reason).not.toBe('tool-not-configured');
  });

  it('treats a missing package.json / unconfigured tool as not configured', async () => {
    const root = tempDir();
    const result = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: { execute: async () => okRun, parse: async () => [], isTreeClean: async () => true },
    });
    expect(result.skipped_reason).toBe('tool-not-configured');
  });

  it('reports a non-stryker tool with no parser as not configured (no marker)', async () => {
    const root = tempDir();
    const result = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.rs'],
      lane: 'full',
      stackProfile: rustStack(),
      testsGreen: true,
      deps: { execute: async () => okRun, isTreeClean: async () => true },
    });
    expect(result.skipped_reason).toBe('tool-not-configured');
  });

  it('parses a Stryker JSON report (all statuses) via the default parser', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'stryker.conf.json'), '{}');
    mkdirSync(join(root, 'reports/mutation'), { recursive: true });
    writeFileSync(
      join(root, 'reports/mutation/mutation.json'),
      JSON.stringify({
        files: {
          'src/a.ts': {
            mutants: [
              { status: 'Killed', location: { start: { line: 1 } }, mutatorName: 'Cond' },
              { status: 'Timeout', location: { start: { line: 2 } }, mutatorName: 'Arith' },
              {
                status: 'Survived',
                location: { start: { line: 3 } },
                mutatorName: 'Bool',
                replacement: 'true',
              },
              { status: 'NoCoverage', location: { start: { line: 4 } }, mutatorName: 'Str' },
              { status: 'Ignored', location: { start: { line: 5 } }, mutatorName: 'Eq' },
              { status: 'CompileError' },
            ],
          },
        },
      }),
    );
    const result = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: { execute: async () => okRun, isTreeClean: async () => true },
    });
    expect(result.killed).toBe(2);
    expect(result.survived).toBe(2);
    expect(result.equivalent_set_aside).toBe(2);
    expect(result.surviving_mutants).toHaveLength(2);
  });

  it('returns run-failed when the Stryker report is missing', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'stryker.conf.json'), '{}');
    const result = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: { execute: async () => okRun, isTreeClean: async () => true },
    });
    expect(result.skipped_reason).toBe('run-failed');
  });

  it('asserts the tree via real git (clean and dirty)', async () => {
    const root = tempDir();
    await execaCommand('git init', { cwd: root });
    const clean = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: { detectTool: async () => true, execute: async () => okRun, parse: async () => [] },
    });
    expect(clean.tree_clean).toBe(true);

    writeFileSync(join(root, 'leftover.txt'), 'mutant residue');
    const dirty = await runMutationGate({
      projectRoot: root,
      changedFiles: ['src/a.ts'],
      lane: 'full',
      stackProfile: tsStack(),
      testsGreen: true,
      deps: {
        detectTool: async () => true,
        execute: async () => okRun,
        parse: async () => [{ file: 'src/a.ts', line: 1, operator: 'Cond', status: 'killed' }],
      },
    });
    expect(dirty.tree_clean).toBe(false);
    expect(dirty.status).toBe('unsafe-tree');
  });
});
