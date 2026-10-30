import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  budgetSummary,
  budgetWarnings,
  escapeAnnotation,
  FILE_BUDGET_MS,
  MISSING_TIMINGS_MAX_PERCENT,
  SHARD_BUDGET_MS,
  summariseShard,
  timingCoverage,
  timingCoverageError,
  timingCoverageSummary,
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

describe('timingCoverage', () => {
  const files = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ path: `tests/f${i}.test.ts`, ms: 1 }));
  const timed = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`tests/f${i}.test.ts`, 1]));

  it('counts each file once across shards against this platform block only', () => {
    const shards = [shard('1', 1, files(3)), shard('2', 1, files(2))];
    const coverage = timingCoverage(shards, { linux: timed(1), win32: timed(3) }, 'linux');
    expect(coverage).toEqual({
      platform: 'linux',
      total: 3,
      missing: ['tests/f1.test.ts', 'tests/f2.test.ts'],
    });
    expect(timingCoverageSummary(coverage, 'Node 22 / ubuntu-latest')).toBe(
      'Timings on Node 22 / ubuntu-latest: 1 of 3 test files have a linux timing.',
    );
  });

  it('reads a missing or broken timings value as no timings', () => {
    const shards = [shard('1', 1, files(2))];
    expect(timingCoverage(shards, null, 'linux').missing).toHaveLength(2);
    expect(timingCoverage(shards, { linux: [] }, 'linux').missing).toHaveLength(2);
  });

  it('AC-3: passes at 0 and exactly 5% missing, and fails just over 5%', () => {
    expect(MISSING_TIMINGS_MAX_PERCENT).toBe(5);
    const shards = [shard('1', 1, files(40))];
    expect(timingCoverageError(timingCoverage(shards, { linux: timed(40) }, 'linux'), 'os')).toBe(
      null,
    );
    expect(timingCoverageError(timingCoverage(shards, { linux: timed(38) }, 'linux'), 'os')).toBe(
      null,
    );
    const error = timingCoverageError(timingCoverage(shards, { linux: timed(37) }, 'linux'), 'win');
    expect(error).toMatch(/^::error title=Shard timings missing::/);
    expect(error).toContain(
      '3 of 40 test files in the win shard reports have no linux timing in tests/shard-timings.json, over the 5 percent limit: tests/f37.test.ts, tests/f38.test.ts, tests/f39.test.ts.',
    );
    expect(error).toContain('scripts/update-shard-timings.mjs');
  });

  it('names the first 10 missing files and counts the rest', () => {
    const error = timingCoverageError(
      timingCoverage([shard('1', 1, files(12))], {}, 'darwin'),
      'mac',
    );
    expect(error).toContain('tests/f7.test.ts and 2 more.');
    expect(error).not.toContain('tests/f9.test.ts');
  });

  it('passes when the shard reports list no files', () => {
    expect(timingCoverageError(timingCoverage([shard('1', 0)], {}, 'linux'), 'os')).toBe(null);
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
      mkdirSync(join(dir, 'tests'));
      writeFileSync(
        join(dir, 'tests', 'shard-timings.json'),
        JSON.stringify({ linux: { 'tests/slow.test.ts': 300_000 } }),
      );
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
      const out = run([
        '--dir',
        dir,
        '--os',
        'Node 22 / ubuntu-latest',
        '--platform',
        'linux',
        '--root',
        dir,
      ]);
      expect(out).toContain(
        'Timings on Node 22 / ubuntu-latest: 1 of 1 test files have a linux timing.',
      );
      expect(out).not.toContain('::error');
      expect(out).toContain('Shard 1 on Node 22 / ubuntu-latest: 300s of tests over 1 files.');
      expect(out).toContain('::warning title=Shard over budget::Shard 1');
      expect(out).toContain('::warning file=tests/slow.test.ts,title=Test file over budget::');
      expect(out).toContain('::warning title=Shard budget::Could not read durations-2.json');
      expect(out).toContain('Could not read durations-sub.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function shardRun(timings: string | null, timedCount: number) {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-shard-timings-'));
    try {
      mkdirSync(join(dir, 'tests'));
      const names = Array.from({ length: 20 }, (_, i) => `tests/f${i}.test.ts`);
      writeFileSync(
        join(dir, 'durations-1.json'),
        JSON.stringify({
          testResults: names.map((name) => ({ name: join(dir, name), startTime: 0, endTime: 1 })),
        }),
      );
      if (timings !== null) writeFileSync(join(dir, 'tests', 'shard-timings.json'), timings);
      else {
        writeFileSync(
          join(dir, 'tests', 'shard-timings.json'),
          JSON.stringify({
            win32: Object.fromEntries(names.slice(0, timedCount).map((n) => [n, 1])),
          }),
        );
      }
      return spawnSync(
        process.execPath,
        [
          SCRIPT,
          '--dir',
          dir,
          '--os',
          'Node 22 / windows-latest',
          '--platform',
          'win32',
          '--root',
          dir,
        ],
        { encoding: 'utf8' },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('AC-3: exits 0 with every file or exactly 5% untimed, and 1 just over 5%', () => {
    expect(shardRun(null, 20).status).toBe(0);
    const atLimit = shardRun(null, 19);
    expect(atLimit.status).toBe(0);
    expect(atLimit.stdout).toContain('19 of 20 test files have a win32 timing.');
    const over = shardRun(null, 18);
    expect(over.status).toBe(1);
    expect(over.stdout).toContain(
      '::error title=Shard timings missing::2 of 20 test files in the Node 22 / windows-latest shard reports have no win32 timing',
    );
  });

  it('exits 1 when the timings file is broken or missing, as no file is timed', () => {
    const broken = shardRun('{ broken', 0);
    expect(broken.status).toBe(1);
    expect(broken.stdout).toContain(
      'Could not read tests/shard-timings.json, so no file has a timing',
    );
    expect(broken.stdout).toContain('20 of 20 test files');
  });

  it('exits 0 with a plain note when there are no reports, ignoring stray arguments', () => {
    const out = run(['--dir', join(tmpdir(), 'paqad-no-such-dir-654'), '--os', 'win32', '--bogus']);
    expect(out).toContain('Ignoring unknown or incomplete argument "--bogus".');
    expect(out).toContain('No shard durations found for win32.');
    expect(out).not.toContain('::warning');
  });
});
