import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  EvalResultError,
  formatSuite,
  judgeSuite,
  suiteScore,
  // @ts-expect-error -- pure JS helper shared with the runnable check-plugin-eval-score.mjs script
} from '../../../scripts/lib/plugin-eval-score.mjs';

const SCRIPT = resolve('scripts/check-plugin-eval-score.mjs');

type Run = { score: number; error?: string | null; graders?: { name: string; passed: boolean }[] };

const run = (score: number, error: string | null = null): Run => ({
  score,
  error,
  graders: [{ name: 'g', passed: score === 1 }],
});
const evalCase = (name: string, withRuns: Run[], withoutRuns: Run[] = [run(0)]) => ({
  name,
  arms: { with: withRuns, without: withoutRuns },
  aggregates: { score: 0.5 },
});
const result = (cases: unknown[], partial = false) => ({
  partial,
  cases,
  aggregates: { overallScore: 0.123 },
});
const meanOf = (withScore: number) => result([evalCase('a', [run(withScore)])]);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function writeResults(files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-eval-score-'));
  temps.push(dir);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}
const cli = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

describe('suiteScore', () => {
  it('takes the with-arm and without-arm means over the cases, never overallScore', () => {
    const score = suiteScore(
      result([
        evalCase('a', [run(1), run(1), run(0)], [run(0), run(0), run(0)]),
        evalCase('b', [run(1), run(1), run(1)], [run(1), run(0), run(0)]),
      ]),
    );
    expect(score.withMean).toBeCloseTo((2 / 3 + 1) / 2);
    expect(score.withoutMean).toBeCloseTo((0 + 1 / 3) / 2);
    expect(score.cases.map((item: { name: string }) => item.name)).toEqual(['a', 'b']);
  });

  it('counts a with-arm run whose error is set as 0', () => {
    const score = suiteScore(result([evalCase('a', [run(1), run(1, 'timed out')])]));
    expect(score.withMean).toBe(0.5);
  });

  it('counts grader passes per arm', () => {
    const score = suiteScore(result([evalCase('a', [run(1), run(0)], [run(0)])]));
    expect(score.graders).toEqual({
      g: { with: { passed: 1, total: 2 }, without: { passed: 0, total: 1 } },
    });
  });

  it('leaves the without-arm mean empty when the run had no baseline', () => {
    const score = suiteScore(result([{ name: 'a', arms: { with: [run(1)] } }]));
    expect(score.withoutMean).toBeNull();
  });

  it.each([
    [{ cases: [] }, '"partial"'],
    [{ partial: false }, '"cases"'],
    [{ partial: false, cases: [{ name: 'a', arms: {} }] }, '"arms.with"'],
    [{ partial: false, cases: [{ name: 'a', arms: { with: [{ error: null }] } }] }, '"score"'],
  ])('names a missing or renamed field', (body, field) => {
    expect(() => suiteScore(body)).toThrow(EvalResultError);
    expect(() => suiteScore(body)).toThrow(field);
  });
});

describe('judgeSuite', () => {
  it('passes a with-arm mean of exactly 0.9 and fails 0.8999', () => {
    expect(judgeSuite(suiteScore(meanOf(0.9)), 0.9).ok).toBe(true);
    expect(judgeSuite(suiteScore(meanOf(0.8999)), 0.9).ok).toBe(false);
  });

  it('passes 18 of 20 full cases at 0.9', () => {
    const cases = Array.from({ length: 20 }, (_, i) =>
      evalCase(`c${i}`, i < 18 ? [run(1), run(1), run(1)] : [run(0), run(0), run(0)]),
    );
    expect(judgeSuite(suiteScore(result(cases)), 0.9).ok).toBe(true);
  });

  it('fails a partial result and an empty suite', () => {
    expect(judgeSuite(suiteScore(result([evalCase('a', [run(1)])], true)), 0.9)).toMatchObject({
      ok: false,
      reason: 'partial result',
    });
    expect(judgeSuite(suiteScore(result([])), 0.9)).toMatchObject({
      ok: false,
      reason: 'no cases',
    });
  });
});

describe('formatSuite', () => {
  it('prints both means and names every case under 1.0', () => {
    const score = suiteScore(result([evalCase('a', [run(1)]), evalCase('b', [run(0.5)])]));
    const lines = formatSuite('routing', score, judgeSuite(score, 0.9), true);
    expect(lines[0]).toBe(
      'routing: with 0.75, without 0.00 over 2 cases, FAIL (with-plugin mean is under 0.9)',
    );
    expect(lines).toContain('  below 1.0: b with 0.50, without 0.00');
    expect(lines.some((line: string) => line.includes(' a with'))).toBe(false);
  });
});

describe('check-plugin-eval-score CLI', () => {
  it('exits 0 when both gated suites are at or above the bar', () => {
    const dir = writeResults({ 'r.json': meanOf(1), 'f.json': meanOf(0.9) });
    const out = cli(
      `routing=${join(dir, 'r.json')}`,
      `firewall=${join(dir, 'f.json')}`,
      '--min',
      '0.9',
    );
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('routing: with 1.00');
    expect(out.stdout).toContain('firewall: with 0.90');
  });

  it('exits 1 when either gated suite is under the bar', () => {
    const dir = writeResults({ 'r.json': meanOf(1), 'f.json': meanOf(0.85) });
    const out = cli(
      `routing=${join(dir, 'r.json')}`,
      `firewall=${join(dir, 'f.json')}`,
      '--min',
      '0.9',
    );
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('firewall: with 0.85, without 0.00 over 1 cases, FAIL');
  });

  it('exits 1 on a partial result, a missing file and a malformed file', () => {
    const dir = writeResults({ 'p.json': result([evalCase('a', [run(1)])], true), 'm.json': '{' });
    expect(cli(`routing=${join(dir, 'p.json')}`, '--min', '0.9').status).toBe(1);
    const missing = cli(`routing=${join(dir, 'none.json')}`, '--min', '0.9');
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain('no result file');
    expect(cli(`routing=${join(dir, 'm.json')}`, '--min', '0.9').status).toBe(1);
  });

  it('prints a report-only suite and never fails on it', () => {
    const dir = writeResults({ 'r.json': meanOf(1), 'x.json': meanOf(0.1) });
    const out = cli(
      `routing=${join(dir, 'r.json')}`,
      '--report-only',
      `receipt=${join(dir, 'x.json')}`,
      '--min',
      '0.9',
    );
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('receipt: with 0.10, without 0.00 over 1 cases, REPORTED');
    const gone = cli(
      `routing=${join(dir, 'r.json')}`,
      '--report-only',
      'receipt=/nope.json',
      '--min',
      '0.9',
    );
    expect(gone.status).toBe(0);
    expect(gone.stdout).toContain('receipt: NO SCORE');
    const alone = cli('--report-only', `receipt=${join(dir, 'x.json')}`, '--min', '0.9');
    expect(alone.status).toBe(0);
    expect(alone.stdout).toContain('REPORTED');
  });

  it('exits 1 on bad arguments', () => {
    expect(cli('--min', '0.9').status).toBe(1);
    expect(cli('routing=x.json').status).toBe(1);
    expect(cli('routing', '--min', '0.9').status).toBe(1);
  });
});
