import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  budgetSummary,
  budgetWarnings,
  escapeAnnotation,
  FILE_BUDGET_MS,
  SHARD_BUDGET_MS,
  summariseShard,
  // @ts-expect-error -- pure JS helper shared with the runnable check-shard-budget.mjs script
} from '../../../scripts/lib/shard-budget.mjs';

const SCRIPT = resolve('scripts/check-shard-budget.mjs');

type Shard = { label: string; wallMs: number; files: { path: string; ms: number }[] };

const shard = (label: string, wallMs: number, files: Shard['files'] = []): Shard => ({
  label,
  wallMs,
  files,
});

describe('budgets', () => {
  it('are 270s per shard and 90s per file', () => {
    expect(SHARD_BUDGET_MS).toBe(270_000);
    expect(FILE_BUDGET_MS).toBe(90_000);
  });
});

describe('escapeAnnotation', () => {
  it('escapes percent signs and line breaks', () => {
    expect(escapeAnnotation('50% done\r\nnext')).toBe('50%25 done%0D%0Anext');
  });
});

describe('summariseShard', () => {
  it('measures the shard from its run start to the last file and each file on its own', () => {
    const root = '/repo';
    const summary = summariseShard(
      '2',
      {
        startTime: 1_000,
        testResults: [
          { name: '/repo/tests/a.test.ts', startTime: 2_000, endTime: 5_000 },
          { name: 'C:\\repo\\tests\\b.test.ts', startTime: 3_000, endTime: 9_000 },
          { name: 'tests/c.test.ts', startTime: 9_000, endTime: 8_000 },
        ],
      },
      root,
    );
    expect(summary).toEqual({
      label: '2',
      wallMs: 8_000,
      files: [
        { path: 'tests/a.test.ts', ms: 3_000 },
        { path: 'C:/repo/tests/b.test.ts', ms: 6_000 },
        { path: 'tests/c.test.ts', ms: 0 },
      ],
    });
  });

  it('strips a Windows root written with backslashes', () => {
    const summary = summariseShard(
      '1',
      { testResults: [{ name: 'D:/a/repo/tests/a.test.ts', startTime: 0, endTime: 1 }] },
      'D:\\a\\repo\\',
    );
    expect(summary.files).toEqual([{ path: 'tests/a.test.ts', ms: 1 }]);
    expect(summary.wallMs).toBe(1);
  });

  it('skips entries without a name or times, and reads an empty or broken report as nothing', () => {
    const report = {
      testResults: [null, { startTime: 0, endTime: 1 }, { name: 'tests/x.test.ts', startTime: 0 }],
    };
    expect(summariseShard('1', report)).toEqual({ label: '1', wallMs: 0, files: [] });
    expect(summariseShard('1', null)).toEqual({ label: '1', wallMs: 0, files: [] });
    expect(summariseShard('1', { testResults: 'nope' })).toEqual({
      label: '1',
      wallMs: 0,
      files: [],
    });
  });

  it('keeps paths that do not start with the root as they are', () => {
    const summary = summariseShard('1', {
      testResults: [{ name: '/elsewhere/a.test.ts', startTime: 0, endTime: 1 }],
    });
    expect(summary.files[0].path).toBe('/elsewhere/a.test.ts');
  });
});

describe('budgetWarnings', () => {
  it('says nothing when every shard and file is inside its budget', () => {
    expect(budgetWarnings([shard('1', 270_000, [{ path: 'a', ms: 90_000 }])], 'linux')).toEqual([]);
    expect(budgetWarnings([], 'linux')).toEqual([]);
  });

  it('names the slowest shard over 270s and the fix', () => {
    const warnings = budgetWarnings([shard('1', 200_000), shard('3', 301_000)], 'win32');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^::warning title=Shard over budget::/);
    expect(warnings[0]).toContain('Shard 3 on win32 took 301s of tests, over the 270s budget.');
    expect(warnings[0]).toContain('tests/shard-timings.json');
    expect(warnings[0]).toContain('scripts/update-shard-timings.mjs');
    expect(warnings[0]).toContain('raise this OS shard count by one');
  });

  it('names every file over 90s, slowest first, with its shard and the fix', () => {
    const warnings = budgetWarnings(
      [
        shard('1', 100_000, [
          { path: 'tests/b.test.ts', ms: 95_000 },
          { path: 'tests/ok.test.ts', ms: 1_000 },
        ]),
        shard('2', 100_000, [
          { path: 'tests/a.test.ts', ms: 95_000 },
          { path: 'tests/huge.test.ts', ms: 200_000 },
        ]),
      ],
      'linux',
    );
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(
      /^::warning file=tests\/huge\.test\.ts,title=Test file over budget::/,
    );
    expect(warnings[0]).toContain('tests/huge.test.ts took 200s on linux (shard 2)');
    expect(warnings[0]).toContain('Split it into smaller test files');
    expect(warnings[1]).toContain('tests/a.test.ts took 95s');
    expect(warnings[2]).toContain('tests/b.test.ts took 95s');
  });

  it('takes other budgets when given', () => {
    const warnings = budgetWarnings([shard('1', 11, [{ path: 'a', ms: 6 }])], 'darwin', {
      shardMs: 10,
      fileMs: 5,
    });
    expect(warnings).toHaveLength(2);
  });

  it('picks the first of two equally slow shards', () => {
    const warnings = budgetWarnings([shard('1', 300_000), shard('2', 300_000)], 'linux');
    expect(warnings[0]).toContain('Shard 1 on linux');
  });
});

describe('budgetSummary', () => {
  it('lists the shards slowest first', () => {
    expect(
      budgetSummary(
        [shard('1', 10_000, [{ path: 'a', ms: 1 }]), shard('2', 20_000), shard('3', 20_000)],
        'linux',
      ),
    ).toEqual([
      'Shard 2 on linux: 20s of tests over 0 files.',
      'Shard 3 on linux: 20s of tests over 0 files.',
      'Shard 1 on linux: 10s of tests over 1 files.',
    ]);
  });

  it('says when there is nothing to check', () => {
    expect(budgetSummary([], 'win32')).toEqual(['No shard durations found for win32.']);
  });
});

describe('check-shard-budget.mjs', () => {
  const run = (args: string[]) =>
    execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });

  it('warns on a slow shard and file, and still exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-shard-budget-'));
    try {
      writeFileSync(
        join(dir, 'durations-1.json'),
        JSON.stringify({
          startTime: 0,
          testResults: [
            { name: join(dir, 'tests', 'slow.test.ts'), startTime: 0, endTime: 300_000 },
          ],
        }),
      );
      writeFileSync(join(dir, 'durations-2.json'), '{ broken');
      writeFileSync(join(dir, 'blob-1-3.json'), 'not mine');
      mkdirSync(join(dir, 'durations-sub.json'));
      const out = run(['--dir', dir, '--os', 'Node 22 / ubuntu-latest', '--root', dir]);
      expect(out).toContain('Shard 1 on Node 22 / ubuntu-latest: 300s of tests over 1 files.');
      expect(out).toContain('::warning title=Shard over budget::Shard 1');
      expect(out).toContain('::warning file=tests/slow.test.ts,title=Test file over budget::');
      expect(out).toContain('::warning title=Shard budget::Could not read durations-2.json');
      expect(out).toContain('Could not read durations-sub.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 with a plain note when there are no reports, ignoring stray arguments', () => {
    const out = run(['--dir', join(tmpdir(), 'paqad-no-such-dir-654'), '--os', 'win32', '--bogus']);
    expect(out).toContain('Ignoring unknown or incomplete argument "--bogus".');
    expect(out).toContain('No shard durations found for win32.');
    expect(out).not.toContain('::warning');
  });
});
