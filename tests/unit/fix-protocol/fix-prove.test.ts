import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeChecksReportForFeature } from '@/checks/report-target.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import {
  appendFixProofRow,
  countedRedRow,
  readFixProofRows,
  type FixProofRow,
} from '@/fix-protocol/fix-proof-record.js';
import {
  proveFix,
  runProofCommand,
  type ProofCommandResult,
  type ProofCommandRunner,
} from '@/fix-protocol/fix-prove.js';

const SES = 'ses-fix-prove';
const TEST_ID = 'login > rejects an empty password';
const NOW = () => new Date('2026-10-20T10:00:00.000Z');

function result(partial: Partial<ProofCommandResult>): ProofCommandResult {
  return {
    exit_code: 0,
    timed_out: false,
    spawn_failed: false,
    invalid: null,
    output: '',
    duration_ms: 12,
    ...partial,
  };
}

function runner(...results: ProofCommandResult[]): ProofCommandRunner & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (command: string) => {
    calls.push(command);
    return results[Math.min(calls.length - 1, results.length - 1)]!;
  }) as ProofCommandRunner & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const failingRun = result({ exit_code: 1, output: `FAIL ${TEST_ID}\nexpected 400` });
const passingRun = result({ exit_code: 0, output: `PASS ${TEST_ID}` });

function checksWithFailures(ids: string[], errorIds: string[] = []): StructuredTestResult {
  return {
    failures: ids.map((test_id) => ({ test_id, message: 'boom' })),
    errors: errorIds.map((test_id) => ({ test_id, message: 'crash' })),
  } as unknown as StructuredTestResult;
}

describe('proveFix', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-fix-prove-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    dir = openFeatureChange(root, SES, { adapter: 'claude-code', lane: 'fast' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function prove(phase: 'red' | 'green', run: ProofCommandRunner): Promise<FixProofRow> {
    return proveFix({
      projectRoot: root,
      dirName: dir,
      sessionId: SES,
      phase,
      testFile: 'tests/login.test.ts',
      testId: TEST_ID,
      command: 'pnpm vitest run tests/login.test.ts',
      now: NOW,
      runCommand: run,
    });
  }

  it('records a red when the command fails and names the test, with time, commit and tree state', async () => {
    const row = await prove('red', runner(failingRun));
    expect(row).toMatchObject({
      phase: 'red',
      outcome: 'red',
      exit_code: 1,
      duration_ms: 12,
      command: 'pnpm vitest run tests/login.test.ts',
      at: '2026-10-20T10:00:00.000Z',
      commit: null,
      tree_dirty: null,
    });
    const doc = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'fixProof')), 'utf8'));
    expect(doc.doc_type).toBe('paqad.fix-proof');
    expect(doc.rows).toHaveLength(1);
  });

  it('records not-reproduced when the proof passes before the fix', async () => {
    const row = await prove('red', runner(passingRun));
    expect(row.outcome).toBe('not-reproduced');
    expect(countedRedRow(readFixProofRows(root, dir))).toBeNull();
  });

  it.each([
    ['command not found', result({ exit_code: 127, spawn_failed: true })],
    ['not executable', result({ exit_code: 126, output: TEST_ID })],
    ['timeout', result({ exit_code: null, timed_out: true, output: TEST_ID })],
    ['no exit code', result({ exit_code: null, output: TEST_ID })],
    ['failure that does not name the test', result({ exit_code: 1, output: 'tsc: 3 errors' })],
    [
      'unsupported shell syntax',
      result({ exit_code: null, invalid: 'unsupported shell syntax: |' }),
    ],
  ])('writes an error row, never a red, for %s', async (_label, run) => {
    const row = await prove('red', runner(run));
    expect(row.outcome).toBe('error');
    expect(countedRedRow(readFixProofRows(root, dir))).toBeNull();
  });

  it('records a green with no red as a green that lacks its red run', async () => {
    const row = await prove('green', runner(passingRun));
    expect(row.outcome).toBe('green');
    expect(row.reason).toContain('no red run');
    expect(row.protocol_status).toBeUndefined();
  });

  it('records still-failing and error for a green with no red that does not pass', async () => {
    expect((await prove('green', runner(failingRun))).outcome).toBe('still-failing');
    expect(
      (await prove('green', runner(result({ exit_code: 127, spawn_failed: true })))).outcome,
    ).toBe('error');
  });

  it('runs the fix protocol on green after a red and writes the regression guard', async () => {
    await prove('red', runner(failingRun));
    const run = runner(passingRun);
    const row = await prove('green', run);
    expect(run.calls).toHaveLength(1);
    expect(row).toMatchObject({ outcome: 'green', protocol_status: 'fixed' });
    expect(row.guard_path && existsSync(row.guard_path)).toBe(true);
    expect(readFixProofRows(root, dir).map((r) => r.outcome)).toEqual(['red', 'green']);
  });

  it('records still-failing when the proof still fails after the fix', async () => {
    await prove('red', runner(failingRun));
    const row = await prove('green', runner(failingRun));
    expect(row).toMatchObject({
      outcome: 'still-failing',
      protocol_status: 'rejected-proof-still-failing',
    });
  });

  it('holds the fix when the latest checks report fails a test that passed at red time', async () => {
    writeChecksReportForFeature(root, dir, {
      schema_version: 2,
      passed: false,
      ran: true,
      results: [checksWithFailures(['already broken'])],
    });
    await prove('red', runner(failingRun));
    expect(readFixProofRows(root, dir)[0]!.baseline_failing).toEqual(['already broken']);
    writeChecksReportForFeature(root, dir, {
      schema_version: 2,
      passed: false,
      ran: true,
      results: [checksWithFailures(['already broken'], ['checkout > totals'])],
    });
    const row = await prove('green', runner(passingRun));
    expect(row).toMatchObject({ outcome: 'held', protocol_status: 'rejected-regression' });
  });

  it('keeps a flaky first run recoverable by appending a new row', async () => {
    await prove('red', runner(result({ exit_code: 1, output: 'network blip' })));
    await prove('red', runner(failingRun));
    await prove('green', runner(passingRun));
    const rows = readFixProofRows(root, dir);
    expect(rows.map((r) => r.outcome)).toEqual(['error', 'red', 'green']);
    expect(countedRedRow(rows)?.outcome).toBe('red');
  });

  it('pairs green with a hand-written red row that has no baseline or output', async () => {
    const red: FixProofRow = {
      phase: 'red',
      outcome: 'red',
      test_file: 'tests/login.test.ts',
      test_id: TEST_ID,
      command: 'x',
      exit_code: 1,
      timed_out: false,
      duration_ms: 1,
      commit: null,
      tree_dirty: null,
      at: '2026-10-20T09:00:00.000Z',
      reason: 'red',
      output_tail: [],
    };
    appendFixProofRow(root, dir, red, { sessionId: SES });
    expect((await prove('green', runner(passingRun))).protocol_status).toBe('fixed');
  });

  it('records the green error when the proof command cannot run after a red', async () => {
    await prove('red', runner(failingRun));
    const row = await prove('green', runner(result({ exit_code: 127, spawn_failed: true })));
    expect(row.outcome).toBe('error');
  });

  it('drops malformed rows when it reads fix-proof.json', () => {
    writeFileSync(
      join(root, featureFilePath(dir, 'fixProof')),
      JSON.stringify({
        rows: [null, 'x', { phase: 'blue', outcome: 'red', at: 'x' }, { phase: 'red' }],
      }),
    );
    expect(readFixProofRows(root, dir)).toEqual([]);
  });

  it('does not count a red recorded after a passing green', async () => {
    await prove('green', runner(passingRun));
    await prove('red', runner(failingRun));
    expect(countedRedRow(readFixProofRows(root, dir))).toBeNull();
  });
});

describe('proveFix on a comment-only fix in a git repository', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-fix-prove-git-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, '.gitignore'), '.paqad/\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records green as skipped when the change cannot affect behaviour', async () => {
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code' });
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n// note\n');
    const input = {
      projectRoot: root,
      dirName: dir,
      sessionId: SES,
      testFile: 't',
      testId: TEST_ID,
      command: 'x',
      now: NOW,
    };
    await proveFix({ ...input, phase: 'red', runCommand: runner(failingRun) });
    const passed = await proveFix({ ...input, phase: 'green', runCommand: runner(passingRun) });
    expect(passed).toMatchObject({
      outcome: 'green',
      protocol_status: 'skipped-no-behaviour-change',
      tree_dirty: true,
    });
    expect(passed.commit).toMatch(/^[0-9a-f]{40}$/);
    const failed = await proveFix({ ...input, phase: 'green', runCommand: runner(failingRun) });
    expect(failed.outcome).toBe('still-failing');
  });
});

describe('runProofCommand', () => {
  it('runs an argument array without a shell and reports the exit code', async () => {
    const ok = await runProofCommand('node --version', process.cwd(), 30_000);
    expect(ok).toMatchObject({
      exit_code: 0,
      timed_out: false,
      spawn_failed: false,
      invalid: null,
    });
    expect(ok.output).toMatch(/^v\d+/);
  });

  it('reports a missing binary as exit 127', async () => {
    const missing = await runProofCommand('paqad-no-such-binary-xyz', process.cwd(), 30_000);
    expect(missing).toMatchObject({ exit_code: 127, spawn_failed: true });
  });

  it('refuses shell syntax and an empty command without running anything', async () => {
    expect((await runProofCommand('echo hi | cat', process.cwd(), 30_000)).invalid).toContain('|');
    expect((await runProofCommand('   ', process.cwd(), 30_000)).invalid).toBe('empty command');
  });

  it.skipIf(process.platform === 'win32')(
    'marks a command that runs past the limit as timed out',
    async () => {
      const slow = await runProofCommand('sleep 5', process.cwd(), 150);
      expect(slow.timed_out).toBe(true);
    },
  );
});
