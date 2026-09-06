// Persisted check report (issue #318) — the bridge between `paqad-ai checks run`
// (which the agent invokes mid-turn) and the agent-independent completion
// backstop (a separate process on the Stop hook). The runner writes the
// structured results here; the backstop reads them so its verdict proves the
// checks ran instead of assuming they passed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { featureFilePath } from '@/feature-evidence/paths.js';

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

/** Absolute path to a feature bundle's `checks.json` (issue #528). */
export function featureChecksPath(projectRoot: string, dirName: string): string {
  return join(projectRoot, featureFilePath(dirName, 'checks'));
}

/** Persist a report atomically (temp + rename) at an absolute target. */
function atomicWriteReport(target: string, report: ChecksReport): string {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

/** Tolerant read of a report at an absolute target, or null when absent/corrupt (issue #528). */
function readReportAt(target: string): ChecksReport | null {
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

/**
 * Persist the latest check report to the GLOBAL path atomically. This is the fallback for a
 * session with no active feature bundle (non-feature-dev / chat); a feature-development change
 * writes into its bundle via {@link writeFeatureChecks} (issue #528).
 */
export function writeChecksReport(projectRoot: string, report: ChecksReport): string {
  return atomicWriteReport(checksReportPath(projectRoot), report);
}

/**
 * Persist the check report into a feature bundle's `checks.json` atomically (issue #528). The
 * `(projectRoot, dirName)` signature mirrors the other bundle writers; the file lives under the
 * already-ignored `ledger/` tree, so it never churns the git tree.
 */
export function writeFeatureChecks(
  projectRoot: string,
  dirName: string,
  report: ChecksReport,
): string {
  return atomicWriteReport(featureChecksPath(projectRoot, dirName), report);
}

/**
 * Read the latest check report, or null when none exists. Tolerant: a corrupt or
 * partially-written report reads as null (no report) rather than throwing, so a
 * bad file degrades the completion verdict to Inconclusive — never a crash and
 * never a false pass.
 */
export function readChecksReport(projectRoot: string): ChecksReport | null {
  return readReportAt(checksReportPath(projectRoot));
}

/**
 * Tolerant read of a feature bundle's `checks.json`, or null when absent/corrupt (issue #528).
 * Same posture as {@link readChecksReport}: a bad file reads as null (Inconclusive), never a
 * throw and never a false pass.
 */
export function readFeatureChecks(projectRoot: string, dirName: string): ChecksReport | null {
  return readReportAt(featureChecksPath(projectRoot, dirName));
}
