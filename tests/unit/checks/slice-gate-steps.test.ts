import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultSliceGateSteps,
  ownedTypeErrors,
  scopeCommandToFiles,
  sliceTestArgv,
  type SliceCommandRunner,
} from '@/checks/slice-gate-steps.js';
import { runSlicePhase } from '@/cli/commands/stage-slice.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';

import { commitAll, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';
import { openChange } from '../traceability/change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const PLAN = {
  summary: 's',
  workstreams: [
    {
      id: 'store',
      owned_files: ['src/store/**', 'tests/store/**'],
      acs: ['AC-1'],
      depends_on: [],
      provides_seams: [],
      uses_seams: [],
      risk: 'high',
      size_budget: { files: 10 },
    },
  ],
  waves: [['store']],
  joining: [],
};

function sliceRepo(session: string, testBody: string): string {
  const root = makeEmptyRepo('main');
  roots.push(root);
  writeRepoFile(root, 'README.md', 'x\n');
  commitAll(root, 'base');
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    ['commands:', '  test: node', '  test_single: node <pattern>'].join('\n') + '\n',
  );
  const dir = openChange(root, session);
  writeFileSync(join(root, featureFilePath(dir, 'plan')), JSON.stringify(PLAN));
  writeRepoFile(root, 'src/store/rows.mjs', 'export const rows = 1;\n');
  writeRepoFile(
    root,
    'tests/store/rows.test.mjs',
    `const it = (title, fn) => fn();\nit('AC-1 reads rows', () => {});\n${testBody}\n`,
  );
  return root;
}

const OWNED = ['src/store/rows.mjs', 'tests/store/rows.test.mjs'];

describe('slice gate runs the project steps from the stage slice gate command (AC-2)', () => {
  it('AC-2 fails the gate and records a failed slice_gate row when an owned test fails', async () => {
    const root = sliceRepo('ses-g1', 'process.exit(3);');
    await runSlicePhase('start', 'store', {
      projectRoot: root,
      sessionId: 'ses-g1',
      agentId: 'ag-1',
      changedFiles: OWNED,
    });
    const result = await runSlicePhase('gate', 'store', {
      projectRoot: root,
      sessionId: 'ses-g1',
      agentId: 'ag-1',
      changedFiles: OWNED,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/tests: `node tests\/store\/rows\.test\.mjs` exited 3/);
    const rows = readFeatureStageUnit(root, currentFeature(root, 'ses-g1')!).filter(
      (row) => row.kind === 'slice_gate',
    );
    expect(rows.at(-1)?.event_status).toBe('failed');
  });

  it('AC-2 passes the gate when the owned test passes', async () => {
    const root = sliceRepo('ses-g2', 'process.exit(0);');
    const ctx = { projectRoot: root, sessionId: 'ses-g2', agentId: 'ag-2', changedFiles: OWNED };
    await runSlicePhase('start', 'store', ctx);
    const result = await runSlicePhase('gate', 'store', ctx);
    expect(result).toMatchObject({ ok: true });
  });
});

describe('slice gate steps stay on the owned files (AC-2)', () => {
  function pkgRoot(scripts: Record<string, string>): string {
    const root = makeEmptyRepo('main');
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }));
    return root;
  }

  it('AC-2 scopes a package lint script that targets the whole tree to the owned files', () => {
    const root = pkgRoot({ lint: 'eslint .', check: 'eslint . && tsc' });
    expect(scopeCommandToFiles(root, 'pnpm lint', ['src/a.ts'])).toEqual([
      'pnpm',
      'exec',
      'eslint',
      'src/a.ts',
    ]);
    expect(scopeCommandToFiles(root, 'npm run lint', ['src/a.ts'])).toEqual([
      'npm',
      'exec',
      '--',
      'eslint',
      'src/a.ts',
    ]);
    expect(scopeCommandToFiles(root, 'ruff check .', ['a.py'])).toEqual(['ruff', 'check', 'a.py']);
    expect(scopeCommandToFiles(root, 'pnpm check', ['src/a.ts'])).toBeNull();
    expect(scopeCommandToFiles(root, 'make lint', ['src/a.ts'])).toBeNull();
  });

  it('AC-2 runs only the slice test files with at most two workers', () => {
    const root = pkgRoot({ test: 'vitest run' });
    expect(
      sliceTestArgv(
        root,
        {
          commands: { test: 'pnpm test', test_single: 'pnpm test <pattern> --reporter=tap' },
        } as never,
        ['tests/a.test.ts', 'tests/b.test.ts'],
      ),
    ).toEqual([
      'pnpm',
      'test',
      'tests/a.test.ts',
      'tests/b.test.ts',
      '--reporter=tap',
      '--maxWorkers=2',
    ]);
    expect(
      sliceTestArgv(root, { commands: { test: 'go test', test_single: '' } } as never, [
        'a_test.go',
      ]),
    ).toEqual(['go', 'test', 'a_test.go']);
  });

  it('AC-2 judges typecheck output only on the owned files', () => {
    const output = [
      'src/a.ts(3,5): error TS2322: bad',
      'src/other.ts(1,1): error TS2304: elsewhere',
    ].join('\n');
    expect(ownedTypeErrors(output, ['src/a.ts'])).toEqual(['src/a.ts(3,5): error TS2322: bad']);
    expect(ownedTypeErrors(output, ['src/b.ts'])).toEqual([]);
    expect(ownedTypeErrors('tsconfig broken', ['src/b.ts'])).toBeNull();
  });

  it('AC-2 AC-34 runs lint, typecheck and tests through the project commands within the time limit', async () => {
    const root = pkgRoot({ lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run' });
    writeRepoFile(root, 'src/a.ts', 'x');
    writeRepoFile(root, 'tests/a.test.ts', 'x');
    const calls: Array<{ argv: string[]; timeout: number }> = [];
    const run: SliceCommandRunner = async (bin, args, timeout) => {
      calls.push({ argv: [bin, ...args], timeout });
      if (args.includes('typecheck')) {
        return {
          exitCode: 2,
          output: 'src/a.ts(1,1): error TS1: no\nsrc/z.ts(1,1): error',
          timedOut: false,
        };
      }
      if (bin === 'pnpm' && args[0] === 'test') return { exitCode: 0, output: '', timedOut: true };
      return { exitCode: 0, output: '', timedOut: false };
    };
    const steps = defaultSliceGateSteps({
      projectRoot: root,
      deadlineMs: 1_000,
      nowMs: () => 400,
      run,
      profile: {
        commands: { lint: 'pnpm lint', test: 'pnpm test', test_single: 'pnpm test <pattern>' },
      } as never,
    });
    const files = ['src/a.ts', 'tests/a.test.ts'];
    expect(await steps.lint(files, ['tests/a.test.ts'])).toEqual([]);
    expect(await steps.typecheck(files, ['tests/a.test.ts'])).toEqual([
      'typecheck: src/a.ts(1,1): error TS1: no',
    ]);
    const tests = await steps.tests(files, ['tests/a.test.ts']);
    expect(tests[0]).toMatch(/stopped at the slice gate time limit/);
    expect(calls.map((c) => c.argv.join(' '))).toEqual([
      'pnpm exec eslint src/a.ts tests/a.test.ts',
      'pnpm run typecheck',
      'pnpm test tests/a.test.ts --maxWorkers=2',
    ]);
    expect(calls.every((c) => c.timeout === 600)).toBe(true);
  });
});
