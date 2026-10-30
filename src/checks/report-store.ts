import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import type { TreeIdentity } from '@/checks/tree-identity.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { stampFeatureDocument } from '@/feature-evidence/bundle-document.js';
import { ENVELOPE_HEADER_KEYS, type EnvelopeHeader } from '@/feature-evidence/envelope.js';
import { featureFilePath } from '@/feature-evidence/paths.js';

export const CHECKS_REPORT_SCHEMA_VERSION = 3;

export const CHECKS_BUNDLE_SCHEMA_VERSION = 3;

export const CHECKS_DOC_TYPE = 'paqad.checks';

const REPORT_HEADER_KEYS: ReadonlySet<string> = new Set([...ENVELOPE_HEADER_KEYS, 'generated_at']);

export interface ChecksReportMode {
  parallel_commands: boolean;
  test_mode: 'native' | 'parallel' | 'sequential';
  processes: number | null;
  fallback_reason: string | null;
}

export interface ChecksReportCommand {
  logical_command: string | null;
  command: string;
  exit_code: number;
  passed: boolean;
  stage: 1 | 2 | 3;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  output_tail?: string[];
  outcome?: 'inconclusive' | 'reused';
  reused_from?: string;
  tree_digest?: string;
  build_output_fingerprint?: string;
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
  generated_at?: string;
  passed: boolean;
  ran: boolean;
  results: StructuredTestResult[];
  mode?: ChecksReportMode;
  commands?: ChecksReportCommand[];
  isolation_reruns?: ChecksReportIsolation;
  flaky_under_parallel?: ChecksReportFlaky[];
  meaningful_green?: boolean;
  critical_path?: ChecksReportCriticalPath;
  tree?: TreeIdentity;
  tree_unavailable_reason?: string;
  run_id?: string;
  lockfile_hash?: string | null;
  node_version?: string;
}

export function checksReportPath(projectRoot: string): string {
  return join(projectRoot, PATHS.CHECKS_REPORT);
}

export function featureChecksPath(projectRoot: string, dirName: string): string {
  return join(projectRoot, featureFilePath(dirName, 'checks'));
}

function atomicWriteReport(target: string, report: ChecksReport): string {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n', 'utf8');
  renameWithRetrySync(tmp, target);
  return target;
}

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

export function writeChecksReport(projectRoot: string, report: ChecksReport): string {
  return atomicWriteReport(checksReportPath(projectRoot), report);
}

export function writeFeatureChecks(
  projectRoot: string,
  dirName: string,
  report: ChecksReport,
  sessionId?: string | null,
): string {
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

export function readChecksReport(projectRoot: string): ChecksReport | null {
  return readReportAt(checksReportPath(projectRoot));
}

export function readFeatureChecks(projectRoot: string, dirName: string): ChecksReport | null {
  return readReportAt(featureChecksPath(projectRoot, dirName));
}
