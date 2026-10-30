import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { withFileLockSync } from '@/core/fs/file-lock.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import type { ChecksReport, ChecksReportCommand } from '@/checks/report-store.js';
import type { TreeIdentity } from '@/checks/tree-identity.js';

export const RUN_HISTORY_CAP = 50;

export interface RunHistoryRow {
  run_id: string;
  logical_command: string | null;
  command: string;
  tree_digest: string;
  ran_at: string;
  passed: boolean;
  reusable: boolean;
  report_path: string;
  report_sha256: string;
}

export interface RunSnapshot extends ChecksReport {
  run_id: string;
  tree: TreeIdentity;
  lockfile_hash: string | null;
  node_version: string;
  commands: ChecksReportCommand[];
  test_result: StructuredTestResult | null;
}

export interface WantedCommand {
  logical_command: string | null;
  command: string;
}

export interface ReuseKey {
  tree_digest: string;
  lockfile_hash: string | null;
  node_version: string;
  build_output_fingerprint: string | null;
}

export interface ReusedCommand {
  row: RunHistoryRow;
  command: ChecksReportCommand;
  test_result: StructuredTestResult | null;
}

export function runHistoryPath(projectRoot: string): string {
  return join(projectRoot, PATHS.CHECKS_RUN_HISTORY);
}

export function runSnapshotRelativePath(runId: string): string {
  return `${PATHS.CHECKS_RUNS_DIR}/${runId}.json`;
}

export function readRunHistory(projectRoot: string): RunHistoryRow[] {
  const target = runHistoryPath(projectRoot);
  if (!existsSync(target)) return [];
  const rows: RunHistoryRow[] = [];
  for (const line of readFileSync(target, 'utf8').split('\n')) {
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  return rows;
}

function parseRow(line: string): RunHistoryRow | null {
  if (line.trim().length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  return isRow(value) ? value : null;
}

function isRow(value: unknown): value is RunHistoryRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.run_id === 'string' &&
    /^[0-9A-Za-z]+$/.test(row.run_id) &&
    (row.logical_command === null || typeof row.logical_command === 'string') &&
    typeof row.command === 'string' &&
    typeof row.tree_digest === 'string' &&
    typeof row.ran_at === 'string' &&
    typeof row.passed === 'boolean' &&
    typeof row.reusable === 'boolean' &&
    row.report_path === runSnapshotRelativePath(row.run_id) &&
    typeof row.report_sha256 === 'string'
  );
}

export function writeRunSnapshot(
  projectRoot: string,
  snapshot: RunSnapshot,
): { report_path: string; report_sha256: string } {
  const reportPath = runSnapshotRelativePath(snapshot.run_id);
  const target = join(projectRoot, reportPath);
  const body = JSON.stringify(snapshot, null, 2) + '\n';
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, body, 'utf8');
  renameWithRetrySync(`${target}.tmp`, target);
  return { report_path: reportPath, report_sha256: sha256(body) };
}

export function appendRunHistory(projectRoot: string, rows: readonly RunHistoryRow[]): void {
  if (rows.length === 0) return;
  const target = runHistoryPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  withFileLockSync(`${target}.lock`, () => {
    const all = [...readRunHistory(projectRoot), ...rows];
    const kept = all.slice(-RUN_HISTORY_CAP);
    const trimmed = all.slice(0, all.length - kept.length);
    writeFileSync(`${target}.tmp`, kept.map((row) => JSON.stringify(row)).join('\n') + '\n');
    renameWithRetrySync(`${target}.tmp`, target);
    const stillReferenced = new Set(kept.map((row) => row.report_path));
    for (const path of new Set(trimmed.map((row) => row.report_path))) {
      if (!stillReferenced.has(path)) rmSync(join(projectRoot, path), { force: true });
    }
  });
}

export function findReusableRuns(
  projectRoot: string,
  rows: readonly RunHistoryRow[],
  wanted: readonly WantedCommand[],
  key: ReuseKey,
): ReusedCommand[] | null {
  if (wanted.length === 0) return null;
  const snapshots = new Map<string, RunSnapshot | null>();
  const reused: ReusedCommand[] = [];
  const newestFirst = [...rows].reverse();
  for (const command of wanted) {
    const row = newestFirst.find((candidate) => candidate.command === command.command);
    if (!row || !row.reusable || !row.passed || row.tree_digest !== key.tree_digest) return null;
    if (!snapshots.has(row.report_path)) {
      snapshots.set(row.report_path, readVerifiedSnapshot(projectRoot, row));
    }
    const snapshot = snapshots.get(row.report_path) ?? null;
    const match = snapshot ? matchSnapshot(snapshot, row, command, key) : null;
    if (!match) return null;
    reused.push(match);
  }
  return reused;
}

function readVerifiedSnapshot(projectRoot: string, row: RunHistoryRow): RunSnapshot | null {
  let body: string;
  try {
    body = readFileSync(join(projectRoot, row.report_path), 'utf8');
  } catch {
    return null;
  }
  if (sha256(body) !== row.report_sha256) return null;
  try {
    const parsed = JSON.parse(body) as RunSnapshot;
    return typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.commands)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function matchSnapshot(
  snapshot: RunSnapshot,
  row: RunHistoryRow,
  wanted: WantedCommand,
  key: ReuseKey,
): ReusedCommand | null {
  if (
    snapshot.run_id !== row.run_id ||
    snapshot.tree?.digest !== key.tree_digest ||
    snapshot.lockfile_hash !== key.lockfile_hash ||
    snapshot.node_version !== key.node_version
  ) {
    return null;
  }
  const command = snapshot.commands.find(
    (candidate) =>
      candidate.command === wanted.command &&
      candidate.logical_command === wanted.logical_command &&
      candidate.passed === true &&
      candidate.exit_code === 0 &&
      candidate.outcome === undefined &&
      candidate.tree_digest === key.tree_digest,
  );
  if (!command) return null;
  if (wanted.logical_command === 'build') {
    if (
      key.build_output_fingerprint === null ||
      command.build_output_fingerprint !== key.build_output_fingerprint
    ) {
      return null;
    }
  }
  if (wanted.logical_command !== 'test') return { row, command, test_result: null };
  const test = snapshot.test_result;
  if (
    snapshot.meaningful_green !== true ||
    !test ||
    test.summary.total <= 0 ||
    test.summary.failed + test.summary.errored > 0 ||
    test.parse_metadata.parse_strategy === 'plain-text-fallback'
  ) {
    return null;
  }
  return { row, command, test_result: test };
}

function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
