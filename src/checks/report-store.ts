// Persisted check report (issue #318) — the bridge between `paqad-ai checks run`
// (which the agent invokes mid-turn) and the agent-independent completion
// backstop (a separate process on the Stop hook). The runner writes the
// structured results here; the backstop reads them so its verdict proves the
// checks ran instead of assuming they passed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';

export const CHECKS_REPORT_SCHEMA_VERSION = 1;

export interface ChecksReport {
  schema_version: typeof CHECKS_REPORT_SCHEMA_VERSION;
  generated_at: string;
  /** Every executed command exited 0. */
  passed: boolean;
  /** At least one command was resolved and executed. */
  ran: boolean;
  results: StructuredTestResult[];
}

export function checksReportPath(projectRoot: string): string {
  return join(projectRoot, PATHS.CHECKS_REPORT);
}

/** Persist the latest check report atomically (temp + rename). */
export function writeChecksReport(projectRoot: string, report: ChecksReport): string {
  const target = checksReportPath(projectRoot);
  mkdirSync(join(projectRoot, PATHS.CHECKS_DIR), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

/**
 * Read the latest check report, or null when none exists. Tolerant: a corrupt or
 * partially-written report reads as null (no report) rather than throwing, so a
 * bad file degrades the completion verdict to Inconclusive — never a crash and
 * never a false pass.
 */
export function readChecksReport(projectRoot: string): ChecksReport | null {
  const target = checksReportPath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as ChecksReport;
    if (typeof parsed?.passed !== 'boolean' || !Array.isArray(parsed?.results)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
