// Persisted check report (issue #318) — the bridge between `paqad-ai checks run`
// (which the agent invokes mid-turn) and the agent-independent completion
// backstop (a separate process on the Stop hook). The runner writes the
// structured results here; the backstop reads them so its verdict proves the
// checks ran instead of assuming they passed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { stampFeatureDocument } from '@/feature-evidence/bundle-document.js';
import { ENVELOPE_HEADER_KEYS, type EnvelopeHeader } from '@/feature-evidence/envelope.js';
import { featureFilePath } from '@/feature-evidence/paths.js';

// Issue #554 — schema 2, ADDITIVE: `passed`, `ran`, `results[]` keep their meaning, so every v1
// reader (readReportAt, checksEvidenceGate, checksRows) reads a v2 file unchanged (INV-6).
export const CHECKS_REPORT_SCHEMA_VERSION = 2;

/**
 * Issue #581 — the bundle's `checks.json` carries the one envelope header, whose `recorded_at`
 * replaces `generated_at`. The body is the v2 report unchanged, so every reader still reads it.
 * The global fallback file is not a bundle file and keeps the v2 shape.
 */
export const CHECKS_BUNDLE_SCHEMA_VERSION = 3;

/** Doc type of the bundle's `checks.json` (`paqad.<file-stem>`, issue #581). */
export const CHECKS_DOC_TYPE = 'paqad.checks';

/** The keys a report carries that the bundle header replaces (issue #581). */
const REPORT_HEADER_KEYS: ReadonlySet<string> = new Set([...ENVELOPE_HEADER_KEYS, 'generated_at']);

/** How the run was executed (issue #554). */
export interface ChecksReportMode {
  parallel_commands: boolean;
  test_mode: 'native' | 'parallel' | 'sequential';
  processes: number | null;
  fallback_reason: string | null;
}

/** One command's timed outcome (issue #554). */
export interface ChecksReportCommand {
  logical_command: string | null;
  command: string;
  exit_code: number;
  passed: boolean;
  stage: 1 | 2 | 3;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  /** Last lines of combined output, only when the command was red. */
  output_tail?: string[];
}

export interface ChecksReportIsolationEntry {
  test_id: string;
  file_path: string | null;
  line_number: number | null;
  selector: string | null;
  attempts: number;
  passes: number;
  verdict: 'real' | 'recovered' | 'flaky';
  blocking: boolean;
  reason?: string;
}

export interface ChecksReportIsolation {
  performed: boolean;
  skipped_reason: string | null;
  rerun_count: number;
  entries: ChecksReportIsolationEntry[];
}

export interface ChecksReportFlaky {
  test_id: string;
  file_path: string | null;
  line_number: number | null;
  suspected_causes: string[];
}

export interface ChecksReportCriticalPath {
  logical_command: string | null;
  duration_ms: number;
}

export interface ChecksReport extends Partial<Omit<EnvelopeHeader, 'schema_version'>> {
  schema_version: number;
  /** When the run finished. The bundle copy carries it as the header's `recorded_at` instead. */
  generated_at?: string;
  /** Every non-test command exited 0 and the test result has zero blocking failures. */
  passed: boolean;
  /** At least one command was resolved and executed. */
  ran: boolean;
  results: StructuredTestResult[];
  // ── issue #554, additive (absent on a v1 file) ──
  mode?: ChecksReportMode;
  commands?: ChecksReportCommand[];
  isolation_reruns?: ChecksReportIsolation;
  flaky_under_parallel?: ChecksReportFlaky[];
  meaningful_green?: boolean;
  critical_path?: ChecksReportCriticalPath;
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
 *
 * Issue #581 — the report is stamped with the one envelope header: its `generated_at` becomes
 * the header's `recorded_at` and the report's own version is replaced by the bundle version.
 */
export function writeFeatureChecks(
  projectRoot: string,
  dirName: string,
  report: ChecksReport,
  sessionId?: string | null,
): string {
  // The body is the report without its own header: a report read back from the bundle carries
  // one. The run time (`generated_at`, or the header time of a re-read report) is kept.
  const body = Object.fromEntries(
    Object.entries(report).filter(([key]) => !REPORT_HEADER_KEYS.has(key)),
  );
  const recordedAt = report.generated_at ?? report.recorded_at;
  const stamped = stampFeatureDocument({
    projectRoot,
    dirName,
    docType: CHECKS_DOC_TYPE,
    schemaVersion: CHECKS_BUNDLE_SCHEMA_VERSION,
    sessionId,
    now: recordedAt === undefined ? undefined : () => new Date(recordedAt),
    body,
  }) as unknown as ChecksReport;
  return atomicWriteReport(featureChecksPath(projectRoot, dirName), stamped);
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
