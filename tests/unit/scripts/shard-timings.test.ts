import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import { describe, expect, it } from 'vitest';

import { WIN32_TEST_EXCLUDES } from '../../../vitest.config';
import { SHARD_TIMINGS_FILE } from '../../shared/duration-sequencer';
import {
  timingCoverage,
  timingCoverageError,
  // @ts-expect-error -- pure JS helper shared with the runnable check-shard-budget.mjs script
} from '../../../scripts/lib/shard-budget.mjs';

import {
  durationsFromReports,
  fileDurationMs,
  mergeTimings,
  pruneTimings,
  repoRelativePath,
  serializeTimings,
  // @ts-expect-error -- pure JS helper shared with the runnable update-shard-timings.mjs script
} from '../../../scripts/lib/shard-timings.mjs';

const SCRIPT = resolve('scripts/update-shard-timings.mjs');

describe('tests/shard-timings.json', () => {
  const timings = JSON.parse(readFileSync(SHARD_TIMINGS_FILE, 'utf8')) as Record<
    string,
    Record<string, number>
  >;
  const testFiles = fg.sync('tests/**/*.test.ts', { ignore: ['**/node_modules/**'] }).sort();

  it.each(['darwin', 'linux', 'win32'])(
    'AC-4: the %s block times all but at most the allowed share of the test files that platform runs',
    (platform) => {
      const runs = testFiles.filter(
        (file) =>
          platform !== 'win32' || !WIN32_TEST_EXCLUDES.some((pattern) => minimatch(file, pattern)),
      );
      const shard = { label: 'all', wallMs: 0, files: runs.map((path) => ({ path, ms: 0 })) };
      const coverage = timingCoverage([shard], timings, platform);
      expect(coverage.total).toBe(runs.length);
      expect(timingCoverageError(coverage, platform)).toBe(null);
    },
  );
});

describe('fileDurationMs', () => {
  it('uses end minus start, rounded', () => {
    expect(fileDurationMs({ startTime: 1000, endTime: 1250.6 })).toBe(251);
  });

  it('never goes below zero', () => {
    expect(fileDurationMs({ startTime: 10, endTime: 5 })).toBe(0);
  });

  it('falls back to the sum of the test durations', () => {
    expect(fileDurationMs({ assertionResults: [{ duration: 1.4 }, { duration: 2.4 }, {}] })).toBe(
      4,
    );
  });

  it('is null when the result carries no timing', () => {
    expect(fileDurationMs({})).toBeNull();
  });
});

describe('repoRelativePath', () => {
  const local = join(tmpdir(), 'paqad-ai npm');
  const present = new Set(['tests/e2e/action-routing.test.ts', 'tests/unit/tests/a.test.ts']);
  const exists = (path: string) => present.has(path);

  it('makes a path under the local root repo-relative with forward slashes', () => {
    expect(repoRelativePath(local, join(local, 'tests', 'a.test.ts'))).toBe('tests/a.test.ts');
  });

  it('keeps a relative path, turning backslashes into slashes', () => {
    expect(repoRelativePath('/repo', 'tests\\unit\\a.test.ts')).toBe('tests/unit/a.test.ts');
  });

  it('maps a linux runner path to the repo path that exists locally', () => {
    expect(
      repoRelativePath(
        local,
        '/home/runner/work/paqad-ai/paqad-ai/tests/e2e/action-routing.test.ts',
        {
          exists,
        },
      ),
    ).toBe('tests/e2e/action-routing.test.ts');
  });

  it('maps a windows runner path, with either slash, to the repo path that exists locally', () => {
    for (const path of [
      'D:/a/paqad-ai/paqad-ai/tests/e2e/action-routing.test.ts',
      'D:\\a\\paqad-ai\\paqad-ai\\tests\\e2e\\action-routing.test.ts',
    ]) {
      expect(repoRelativePath(local, path, { exists })).toBe('tests/e2e/action-routing.test.ts');
    }
  });

  it('anchors on the first tests folder whose remainder exists', () => {
    expect(repoRelativePath(local, '/tests/runner/tests/unit/tests/a.test.ts', { exists })).toBe(
      'tests/unit/tests/a.test.ts',
    );
  });

  it('strips an explicit report root first', () => {
    expect(
      repoRelativePath(local, 'D:/a/paqad-ai/paqad-ai/tests/new.test.ts', {
        reportRoot: 'D:\\a\\paqad-ai\\paqad-ai\\',
        exists: () => false,
      }),
    ).toBe('tests/new.test.ts');
  });

  it('never returns a path that leaves the repo or keeps a drive letter', () => {
    expect(repoRelativePath(local, '/elsewhere/a.test.ts', { exists })).toBeNull();
    expect(repoRelativePath(local, 'D:/a/other/b.test.ts', { exists })).toBeNull();
    expect(repoRelativePath(local, '../outside/tests/a.test.ts')).toBeNull();
    expect(repoRelativePath(local, join(local, '..', 'x', 'a.test.ts'))).toBeNull();
    expect(
      repoRelativePath(local, '/runner/tests/e2e/missing.test.ts', { exists: () => false }),
    ).toBeNull();
  });
});

describe('durationsFromReports', () => {
  const root = join(tmpdir(), 'repo');

  it('maps each file in the report to its duration', () => {
    const report = {
      testResults: [
        { name: join(root, 'tests', 'b.test.ts'), startTime: 0, endTime: 20 },
        { name: join(root, 'tests', 'a.test.ts'), startTime: 0, endTime: 10 },
      ],
    };
    expect(durationsFromReports([report], root)).toEqual({
      durations: { 'tests/a.test.ts': 10, 'tests/b.test.ts': 20 },
      skipped: [],
    });
  });

  it('keeps the larger time for a file in two reports', () => {
    const one = { testResults: [{ name: 'tests/a.test.ts', startTime: 0, endTime: 10 }] };
    const two = { testResults: [{ name: 'tests/a.test.ts', startTime: 0, endTime: 30 }] };
    expect(durationsFromReports([one, two], root).durations).toEqual({ 'tests/a.test.ts': 30 });
    expect(durationsFromReports([two, one], root).durations).toEqual({ 'tests/a.test.ts': 30 });
  });

  it('skips entries with no name or no timing, and reports without results', () => {
    const report = {
      testResults: [null, { startTime: 0, endTime: 5 }, { name: 'tests/x.test.ts' }],
    };
    expect(durationsFromReports([report, null, { testResults: 'nope' }], root)).toEqual({
      durations: {},
      skipped: [],
    });
  });

  it('skips and lists a file it cannot place in the repo instead of writing a bad key', () => {
    const report = {
      testResults: [
        { name: '/home/runner/work/x/x/tests/a.test.ts', startTime: 0, endTime: 5 },
        { name: 'D:/a/x/x/lib/b.test.ts', startTime: 0, endTime: 5 },
      ],
    };
    expect(durationsFromReports([report], root, { exists: () => true })).toEqual({
      durations: { 'tests/a.test.ts': 5 },
      skipped: ['D:/a/x/x/lib/b.test.ts'],
    });
  });
});

describe('mergeTimings', () => {
  it('replaces only the given OS block and sorts keys at both levels', () => {
    const existing = {
      win32: { 'tests/z.test.ts': 9 },
      linux: { 'tests/old.test.ts': 1 },
    };
    const merged = mergeTimings(existing, 'linux', { 'tests/b.test.ts': 2, 'tests/a.test.ts': 1 });
    expect(merged).toEqual({
      linux: { 'tests/a.test.ts': 1, 'tests/b.test.ts': 2 },
      win32: { 'tests/z.test.ts': 9 },
    });
    expect(Object.keys(merged)).toEqual(['linux', 'win32']);
    expect(Object.keys(merged.linux)).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });

  it('starts from empty when the existing value is not an object', () => {
    expect(mergeTimings(null, 'darwin', { a: 1 })).toEqual({ darwin: { a: 1 } });
    expect(mergeTimings([1], 'darwin', {})).toEqual({ darwin: {} });
  });
});

describe('pruneTimings', () => {
  it('drops the entries the keep test rejects from every OS block', () => {
    const keep = (path: string) => path !== 'tests/gone.test.ts';
    expect(
      pruneTimings(
        {
          linux: { 'tests/a.test.ts': 1, 'tests/gone.test.ts': 2 },
          win32: { 'tests/gone.test.ts': 3 },
        },
        keep,
      ),
    ).toEqual({ timings: { linux: { 'tests/a.test.ts': 1 }, win32: {} }, dropped: 2 });
  });

  it('keeps a block that is not an object, and reads a non-object as empty', () => {
    expect(pruneTimings({ darwin: 'x' }, () => false)).toEqual({
      timings: { darwin: 'x' },
      dropped: 0,
    });
    expect(pruneTimings(null, () => false)).toEqual({ timings: {}, dropped: 0 });
  });
});

describe('serializeTimings', () => {
  it('writes two-space JSON with a trailing newline', () => {
    expect(serializeTimings({ linux: { a: 1 } })).toBe('{\n  "linux": {\n    "a": 1\n  }\n}\n');
  });
});

describe('update-shard-timings.mjs', () => {
  function withRoot(run: (root: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), 'paqad-update-shard-timings-'));
    mkdirSync(join(root, 'tests'), { recursive: true });
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const runScript = (args: string[]) =>
    execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });

  it('rewrites only the chosen OS block of tests/shard-timings.json', () => {
    withRoot((root) => {
      const timings = join(root, 'tests', 'shard-timings.json');
      writeFileSync(join(root, 'tests', 'w.test.ts'), '');
      writeFileSync(join(root, 'tests', 'a.test.ts'), '');
      writeFileSync(timings, JSON.stringify({ win32: { 'tests/w.test.ts': 7 }, linux: {} }));
      const report = join(root, 'report.json');
      writeFileSync(
        report,
        JSON.stringify({
          testResults: [{ name: join(root, 'tests', 'a.test.ts'), startTime: 0, endTime: 42 }],
        }),
      );
      const out = runScript(['--report', report, '--platform', 'linux', '--root', root]);
      expect(out).toContain('Wrote 1 linux timings');
      expect(JSON.parse(readFileSync(timings, 'utf8'))).toEqual({
        linux: { 'tests/a.test.ts': 42 },
        win32: { 'tests/w.test.ts': 7 },
      });
    });
  });

  it('drops the timings of test files that no longer exist from every OS block', () => {
    withRoot((root) => {
      const timings = join(root, 'tests', 'shard-timings.json');
      writeFileSync(join(root, 'tests', 'kept.test.ts'), '');
      writeFileSync(
        timings,
        JSON.stringify({
          win32: { 'tests/kept.test.ts': 7, 'tests/onboarding/orchestrator.test.ts': 9 },
          darwin: { 'tests/onboarding/orchestrator.test.ts': 9 },
        }),
      );
      const report = join(root, 'report.json');
      writeFileSync(report, JSON.stringify({ testResults: [] }));
      const out = runScript(['--report', report, '--platform', 'linux', '--root', root]);
      expect(out).toContain('Dropped 2 timings of test files that no longer exist');
      expect(JSON.parse(readFileSync(timings, 'utf8'))).toEqual({
        darwin: {},
        linux: {},
        win32: { 'tests/kept.test.ts': 7 },
      });
    });
  });

  it.each([
    ['linux', '/home/runner/work/paqad-ai/paqad-ai'],
    ['win32', 'D:\\a\\paqad-ai\\paqad-ai'],
  ])('keeps the fresh %s timings from a CI report made in another checkout', (platform, ciRoot) => {
    withRoot((root) => {
      mkdirSync(join(root, 'tests', 'e2e'));
      writeFileSync(join(root, 'tests', 'e2e', 'a.test.ts'), '');
      const sep = ciRoot.includes('\\') ? '\\' : '/';
      const report = join(root, 'report.json');
      writeFileSync(
        report,
        JSON.stringify({
          testResults: [
            { name: [ciRoot, 'tests', 'e2e', 'a.test.ts'].join(sep), startTime: 0, endTime: 42 },
            { name: [ciRoot, 'tests', 'gone.test.ts'].join(sep), startTime: 0, endTime: 7 },
          ],
        }),
      );
      const out = runScript(['--report', report, '--platform', platform, '--root', root]);
      expect(out).toContain(`Wrote 1 ${platform} timings`);
      expect(out).toContain('Skipped 1 report entries with no test file under');
      expect(JSON.parse(readFileSync(join(root, 'tests', 'shard-timings.json'), 'utf8'))).toEqual({
        [platform]: { 'tests/e2e/a.test.ts': 42 },
      });
    });
  });

  it('strips --report-root from the report paths', () => {
    withRoot((root) => {
      writeFileSync(join(root, 'tests', 'a.test.ts'), '');
      const report = join(root, 'report.json');
      writeFileSync(
        report,
        JSON.stringify({
          testResults: [{ name: '/ci/checkout/tests/a.test.ts', startTime: 0, endTime: 3 }],
        }),
      );
      runScript([
        '--report',
        report,
        '--platform',
        'darwin',
        '--root',
        root,
        '--report-root',
        '/ci/checkout',
      ]);
      expect(JSON.parse(readFileSync(join(root, 'tests', 'shard-timings.json'), 'utf8'))).toEqual({
        darwin: { 'tests/a.test.ts': 3 },
      });
    });
  });

  it('creates the file, and starts over when the existing one is broken', () => {
    withRoot((root) => {
      const timings = join(root, 'tests', 'shard-timings.json');
      const report = join(root, 'report.json');
      writeFileSync(report, JSON.stringify({ testResults: [] }));
      runScript(['--report', report, '--platform', 'darwin', '--root', root]);
      expect(JSON.parse(readFileSync(timings, 'utf8'))).toEqual({ darwin: {} });
      writeFileSync(timings, '{ broken');
      runScript(['--report', report, '--platform', 'win32', '--root', root]);
      expect(JSON.parse(readFileSync(timings, 'utf8'))).toEqual({ win32: {} });
    });
  });

  it.each([
    [[], 'at least one --report'],
    [['--report'], '--report requires a value'],
    [['--bogus'], 'unknown argument'],
    [['--report', 'r.json', '--platform', 'beos'], 'unknown platform'],
    [['--report', 'missing.json'], 'cannot read report'],
  ])('exits 2 with a usage message for %j', (args, message) => {
    withRoot((root) => {
      let caught: { status?: number; stderr?: string } = {};
      try {
        runScript(['--root', root, ...args]);
      } catch (error) {
        caught = error as { status?: number; stderr?: string };
      }
      expect(caught.status).toBe(2);
      expect(caught.stderr).toContain(message);
    });
  });
});
