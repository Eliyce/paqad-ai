import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  durationsFromReports,
  fileDurationMs,
  mergeTimings,
  serializeTimings,
  toRootRelativePosix,
  // @ts-expect-error -- pure JS helper shared with the runnable update-shard-timings.mjs script
} from '../../../scripts/lib/shard-timings.mjs';

const SCRIPT = resolve('scripts/update-shard-timings.mjs');

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

describe('toRootRelativePosix', () => {
  it('makes an absolute path root-relative with forward slashes', () => {
    const root = join(tmpdir(), 'repo');
    expect(toRootRelativePosix(root, join(root, 'tests', 'a.test.ts'))).toBe('tests/a.test.ts');
  });

  it('keeps a relative path, turning backslashes into slashes', () => {
    expect(toRootRelativePosix('/repo', 'tests\\unit\\a.test.ts')).toBe('tests/unit/a.test.ts');
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
      'tests/a.test.ts': 10,
      'tests/b.test.ts': 20,
    });
  });

  it('keeps the larger time for a file in two reports', () => {
    const one = { testResults: [{ name: 'tests/a.test.ts', startTime: 0, endTime: 10 }] };
    const two = { testResults: [{ name: 'tests/a.test.ts', startTime: 0, endTime: 30 }] };
    expect(durationsFromReports([one, two], root)).toEqual({ 'tests/a.test.ts': 30 });
    expect(durationsFromReports([two, one], root)).toEqual({ 'tests/a.test.ts': 30 });
  });

  it('skips entries with no name or no timing, and reports without results', () => {
    const report = {
      testResults: [null, { startTime: 0, endTime: 5 }, { name: 'tests/x.test.ts' }],
    };
    expect(durationsFromReports([report, null, { testResults: 'nope' }], root)).toEqual({});
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
