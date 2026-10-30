import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RUN_HISTORY_CAP,
  appendRunHistory,
  findReusableRuns,
  readRunHistory,
  runHistoryPath,
  runSnapshotRelativePath,
  writeRunSnapshot,
} from '@/checks/run-history.js';
import type { ReuseKey, RunHistoryRow, RunSnapshot, WantedCommand } from '@/checks/run-history.js';
import type { ChecksReportCommand } from '@/checks/report-store.js';
import { TEST_OUTPUT_SCHEMA_VERSION } from '@/core/types/test-output.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';

import { useTempRoots } from '../_helpers/temp-roots.js';

const TREE = 'a'.repeat(40);
const KEY: ReuseKey = {
  tree_digest: TREE,
  lockfile_hash: 'l'.repeat(64),
  node_version: 'v22.0.0',
  build_output_fingerprint: 'f'.repeat(64),
};
const TEST: WantedCommand = { logical_command: 'test', command: 'pnpm test' };
const BUILD: WantedCommand = { logical_command: 'build', command: 'pnpm build' };

function testResult(
  overrides: Partial<StructuredTestResult['summary']> = {},
): StructuredTestResult {
  return {
    schema_version: TEST_OUTPUT_SCHEMA_VERSION,
    summary: {
      total: 12,
      passed: 12,
      failed: 0,
      skipped: 0,
      errored: 0,
      duration_ms: 10,
      timestamp: '2026-01-01T00:00:00.000Z',
      runner_id: 'vitest',
      ...overrides,
    },
    failures: [],
    warnings: [],
    parse_metadata: {
      raw_byte_size: 0,
      structured_byte_size: 0,
      compression_ratio: 1,
      original_size: 0,
      compact_size: 0,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      parse_strategy: 'structured',
      parse_warnings: [],
    },
    errors: [],
    evidence_scope: {},
  };
}

function reportCommand(wanted: WantedCommand, extra: Partial<ChecksReportCommand> = {}) {
  return {
    logical_command: wanted.logical_command,
    command: wanted.command,
    exit_code: 0,
    passed: true,
    stage: wanted.logical_command === 'test' ? (3 as const) : (2 as const),
    started_at: '2026-01-01T00:00:00.000Z',
    ended_at: '2026-01-01T00:00:01.000Z',
    duration_ms: 1000,
    tree_digest: TREE,
    ...(wanted.logical_command === 'build'
      ? { build_output_fingerprint: KEY.build_output_fingerprint! }
      : {}),
    ...extra,
  };
}

function snapshot(runId: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schema_version: 3,
    generated_at: '2026-01-01T00:00:01.000Z',
    passed: true,
    ran: true,
    results: [],
    run_id: runId,
    tree: { digest: TREE, head_commit: null, computed_at: '2026-01-01T00:00:01.000Z' },
    lockfile_hash: KEY.lockfile_hash,
    node_version: KEY.node_version,
    meaningful_green: true,
    commands: [reportCommand(BUILD), reportCommand(TEST)],
    test_result: testResult(),
    ...overrides,
  };
}

function record(
  root: string,
  runId: string,
  snap: Partial<RunSnapshot> = {},
  rowOverrides: Partial<RunHistoryRow> = {},
  commands: WantedCommand[] = [BUILD, TEST],
): RunHistoryRow[] {
  const written = writeRunSnapshot(root, snapshot(runId, snap));
  const rows = commands.map((command) => ({
    run_id: runId,
    logical_command: command.logical_command,
    command: command.command,
    tree_digest: TREE,
    ran_at: '2026-01-01T00:00:01.000Z',
    passed: true,
    reusable: true,
    ...written,
    ...rowOverrides,
  }));
  appendRunHistory(root, rows);
  return rows;
}

function lookup(root: string, wanted: WantedCommand[] = [BUILD, TEST], key: ReuseKey = KEY) {
  return findReusableRuns(root, readRunHistory(root), wanted, key);
}

describe('run history', () => {
  const makeRoot = useTempRoots('paqad-run-history-');

  it('reuses the latest green run of each command on the same key', () => {
    const root = makeRoot();
    record(root, 'RUN1');
    const hits = lookup(root);
    expect(hits?.map((hit) => hit.command.command)).toEqual(['pnpm build', 'pnpm test']);
    expect(hits?.[1]?.test_result?.summary.total).toBe(12);
    expect(hits?.[0]?.test_result).toBeNull();
  });

  it('a missing history file means no rows', () => {
    const root = makeRoot();
    expect(readRunHistory(root)).toEqual([]);
    expect(lookup(root)).toBeNull();
  });

  it('an empty wanted list never reuses', () => {
    const root = makeRoot();
    record(root, 'RUN1');
    expect(lookup(root, [])).toBeNull();
  });

  it('AC-4: runs for real when the newest row for the command failed, even with an older green row', () => {
    const root = makeRoot();
    record(root, 'RUN1');
    record(root, 'RUN2', {}, { passed: false, reusable: false }, [TEST]);
    expect(lookup(root)).toBeNull();
  });

  it('AC-4: runs for real when the newest row is on another tree while an older row matches', () => {
    const root = makeRoot();
    record(root, 'RUN1');
    record(root, 'RUN2', {}, { tree_digest: 'b'.repeat(40) }, [TEST]);
    expect(lookup(root)).toBeNull();
  });

  it('never reuses a row recorded as not reusable', () => {
    const root = makeRoot();
    record(root, 'RUN1', {}, { reusable: false });
    expect(lookup(root)).toBeNull();
  });

  it('AC-6: keys on the exact command string, the lockfile hash and the Node version', () => {
    const root = makeRoot();
    record(root, 'RUN1');
    expect(lookup(root, [BUILD, { logical_command: 'test', command: 'pnpm test:coverage' }])).toBe(
      null,
    );
    expect(lookup(root, undefined, { ...KEY, lockfile_hash: 'x'.repeat(64) })).toBeNull();
    expect(lookup(root, undefined, { ...KEY, lockfile_hash: null })).toBeNull();
    expect(lookup(root, undefined, { ...KEY, node_version: 'v20.0.0' })).toBeNull();
    expect(lookup(root, undefined, { ...KEY, tree_digest: 'c'.repeat(40) })).toBeNull();
  });

  it('AC-6: a null lockfile hash matches only a null lockfile hash', () => {
    const root = makeRoot();
    record(root, 'RUN1', { lockfile_hash: null });
    expect(lookup(root, undefined, { ...KEY, lockfile_hash: null })).not.toBeNull();
    expect(lookup(root)).toBeNull();
  });

  it('AC-7: is all or nothing: a reusable build with a non-reusable test reuses neither', () => {
    const root = makeRoot();
    record(root, 'RUN1', {}, {}, [BUILD]);
    record(root, 'RUN2', {}, { reusable: false }, [TEST]);
    expect(lookup(root, [BUILD])).not.toBeNull();
    expect(lookup(root)).toBeNull();
  });

  it('AC-8: a build needs the same build output fingerprint now', () => {
    const root = makeRoot();
    record(root, 'RUN1');
    expect(lookup(root, undefined, { ...KEY, build_output_fingerprint: null })).toBeNull();
    expect(
      lookup(root, undefined, { ...KEY, build_output_fingerprint: 'e'.repeat(64) }),
    ).toBeNull();
    expect(lookup(root, [TEST], { ...KEY, build_output_fingerprint: null })).not.toBeNull();
  });

  describe('trusts a row only when its snapshot agrees', () => {
    it('AC-9: runs for real when the snapshot is missing', () => {
      const root = makeRoot();
      record(root, 'RUN1');
      rmSync(join(root, runSnapshotRelativePath('RUN1')));
      expect(lookup(root)).toBeNull();
    });

    it('AC-9: runs for real when the snapshot was edited (hash mismatch) or does not parse', () => {
      const root = makeRoot();
      const [row] = record(root, 'RUN1');
      const path = join(root, row!.report_path);
      writeFileSync(path, readFileSync(path, 'utf8').replace('"total": 12', '"total": 13'));
      expect(lookup(root)).toBeNull();
      writeFileSync(path, '{ not json');
      appendRunHistory(root, [{ ...row!, report_sha256: sha('{ not json') }]);
      expect(lookup(root, [BUILD])).toBeNull();
      writeFileSync(path, 'null');
      appendRunHistory(root, [{ ...row!, report_sha256: sha('null') }]);
      expect(lookup(root, [BUILD])).toBeNull();
    });

    it.each([
      ['another run id', { run_id: 'OTHER' }],
      ['another tree', { tree: { digest: 'b'.repeat(40), head_commit: null, computed_at: '' } }],
      ['another lockfile', { lockfile_hash: 'z'.repeat(64) }],
      ['another Node version', { node_version: 'v18.0.0' }],
      [
        'a different command',
        { commands: [reportCommand(BUILD), reportCommand({ ...TEST, command: 'pnpm t' })] },
      ],
      [
        'a failed command',
        { commands: [reportCommand(BUILD), reportCommand(TEST, { passed: false })] },
      ],
      [
        'a non-zero exit',
        { commands: [reportCommand(BUILD), reportCommand(TEST, { exit_code: 1 })] },
      ],
      [
        'an inconclusive outcome',
        { commands: [reportCommand(BUILD), reportCommand(TEST, { outcome: 'inconclusive' })] },
      ],
      [
        'a reused outcome',
        { commands: [reportCommand(BUILD), reportCommand(TEST, { outcome: 'reused' })] },
      ],
      [
        'a command on another tree',
        { commands: [reportCommand(BUILD), reportCommand(TEST, { tree_digest: 'b'.repeat(40) })] },
      ],
      ['no test counts', { test_result: null }],
      ['zero tests', { test_result: testResult({ total: 0, passed: 0 }) }],
      ['a failing test', { test_result: testResult({ failed: 1 }) }],
      ['not meaningfully green', { meaningful_green: false }],
      [
        'a plain-text test result',
        {
          test_result: {
            ...testResult(),
            parse_metadata: {
              ...testResult().parse_metadata,
              parse_strategy: 'plain-text-fallback' as const,
            },
          },
        },
      ],
    ] as [string, Partial<RunSnapshot>][])(
      'AC-9: runs for real when the snapshot shows %s',
      (_, snap) => {
        const root = makeRoot();
        record(root, 'RUN1', snap);
        expect(lookup(root)).toBeNull();
      },
    );
  });

  it('AC-9: skips empty, truncated and corrupt lines without crashing', () => {
    const root = makeRoot();
    const [build, test] = record(root, 'RUN1');
    writeFileSync(
      runHistoryPath(root),
      [
        '',
        '{"run_id":',
        'not json',
        '42',
        JSON.stringify({ ...build, report_path: '../../etc/passwd' }),
        JSON.stringify({ ...build, run_id: '../x', report_path: runSnapshotRelativePath('../x') }),
        JSON.stringify(build),
        JSON.stringify(test),
      ].join('\n'),
    );
    expect(readRunHistory(root)).toHaveLength(2);
    expect(lookup(root)).not.toBeNull();
  });

  it('AC-9: keeps the newest rows up to the cap and deletes snapshots no row references', () => {
    const root = makeRoot();
    const first = record(root, 'RUN0', {}, {}, [TEST]);
    for (let index = 1; index < RUN_HISTORY_CAP; index += 1) {
      record(root, `RUN${index}`, {}, {}, [TEST]);
    }
    expect(readRunHistory(root)).toHaveLength(RUN_HISTORY_CAP);
    expect(existsSync(join(root, first[0]!.report_path))).toBe(true);
    record(root, 'RUNLAST', {}, {}, [TEST]);
    const rows = readRunHistory(root);
    expect(rows).toHaveLength(RUN_HISTORY_CAP);
    expect(rows[0]?.run_id).toBe('RUN1');
    expect(rows.at(-1)?.run_id).toBe('RUNLAST');
    expect(existsSync(join(root, first[0]!.report_path))).toBe(false);
    expect(existsSync(join(root, rows[0]!.report_path))).toBe(true);
  });

  it('AC-9: keeps a trimmed run snapshot while another of its rows is still kept', () => {
    const root = makeRoot();
    record(root, 'RUN0');
    for (let index = 1; index < RUN_HISTORY_CAP - 1; index += 1) {
      record(root, `RUN${index}`, {}, {}, [TEST]);
    }
    record(root, 'RUNLAST', {}, {}, [TEST]);
    const rows = readRunHistory(root);
    expect(rows[0]?.run_id).toBe('RUN0');
    expect(existsSync(join(root, runSnapshotRelativePath('RUN0')))).toBe(true);
  });

  it('appends from two runs both keep their rows and release the lock', async () => {
    const root = makeRoot();
    mkdirSync(join(root, '.paqad/checks'), { recursive: true });
    const a = writeRunSnapshot(root, snapshot('RUNA'));
    const b = writeRunSnapshot(root, snapshot('RUNB'));
    const row = (runId: string, written: typeof a): RunHistoryRow => ({
      run_id: runId,
      logical_command: 'test',
      command: 'pnpm test',
      tree_digest: TREE,
      ran_at: '2026-01-01T00:00:00.000Z',
      passed: true,
      reusable: true,
      ...written,
    });
    await Promise.all([
      Promise.resolve().then(() => appendRunHistory(root, [row('RUNA', a)])),
      Promise.resolve().then(() => appendRunHistory(root, [row('RUNB', b)])),
    ]);
    expect(
      readRunHistory(root)
        .map((r) => r.run_id)
        .sort(),
    ).toEqual(['RUNA', 'RUNB']);
    expect(existsSync(`${runHistoryPath(root)}.lock`)).toBe(false);
  });

  it('appending nothing writes nothing', () => {
    const root = makeRoot();
    appendRunHistory(root, []);
    expect(existsSync(runHistoryPath(root))).toBe(false);
  });
});

function sha(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
