// The duplication report cache + session-ledger telemetry (issue #358).
//
// The detector's findings are cached to `.paqad/scripts/rules/.cache/duplication.json` so the
// Stop-seam DuplicationGate reads the same result the checks-stage rule-script produced (one
// computation, two consumers). Per-run counts also fold onto the session ledger (FR-11) so the
// strict-flip decision is driven by real dogfood data, not a guess.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { recordProjectEvent } from '@/session-ledger/project-ledger.js';

import type { DuplicationConfig } from './config.js';
import type { DuplicationFinding } from './types.js';

export const DUPLICATION_EVIDENCE_DOC_TYPE = 'duplication-evidence';
export const DUPLICATION_EVIDENCE_SCHEMA_VERSION = 1;
export const DUPLICATION_REPORT_SCHEMA_VERSION = 1;

export interface DuplicationReport {
  schema_version: number;
  generated_at: string;
  mode: DuplicationConfig['mode'];
  similarity_threshold: number;
  min_lines: number;
  /** Milliseconds the scan took, for the AC-7 budget check. */
  elapsed_ms: number;
  findings: DuplicationFinding[];
  counts: { deterministic: number; heuristic: number };
  /** Blocking only in strict mode with at least one deterministic finding. */
  blocking: boolean;
  /** Decision-packet ids that unblock a finding for this change (AC-5). */
  resolved_decisions?: string[];
}

/** Split findings into their two bands and whether the run blocks under the given mode. */
export function summarizeFindings(
  findings: DuplicationFinding[],
  mode: DuplicationConfig['mode'],
): { counts: { deterministic: number; heuristic: number }; blocking: boolean } {
  const deterministic = findings.filter((f) => f.kind === 'deterministic').length;
  const heuristic = findings.filter((f) => f.kind === 'heuristic').length;
  return {
    counts: { deterministic, heuristic },
    blocking: mode === 'strict' && deterministic > 0,
  };
}

/** Build the report record from findings, config, and the measured elapsed time. */
export function buildDuplicationReport(input: {
  findings: DuplicationFinding[];
  config: DuplicationConfig;
  elapsedMs: number;
  now: string;
  resolvedDecisions?: string[];
}): DuplicationReport {
  const { counts, blocking } = summarizeFindings(input.findings, input.config.mode);
  return {
    schema_version: DUPLICATION_REPORT_SCHEMA_VERSION,
    generated_at: input.now,
    mode: input.config.mode,
    similarity_threshold: input.config.similarityThreshold,
    min_lines: input.config.minLines,
    elapsed_ms: input.elapsedMs,
    findings: input.findings,
    counts,
    blocking,
    ...(input.resolvedDecisions && input.resolvedDecisions.length > 0
      ? { resolved_decisions: input.resolvedDecisions }
      : {}),
  };
}

function reportPath(projectRoot: string): string {
  return join(projectRoot, PATHS.DUPLICATION_REPORT);
}

/** Persist the duplication report to its cache (creating the directory as needed). */
export function writeDuplicationReport(projectRoot: string, report: DuplicationReport): void {
  const path = reportPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/** Read the cached duplication report, or null when absent/unreadable. */
export function readDuplicationReport(projectRoot: string): DuplicationReport | null {
  const path = reportPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DuplicationReport;
  } catch {
    return null;
  }
}

/** Fold the run's counts, threshold, and mode onto the session ledger (FR-11, best-effort). */
export function recordDuplicationRun(projectRoot: string, report: DuplicationReport): void {
  recordProjectEvent(
    projectRoot,
    DUPLICATION_EVIDENCE_DOC_TYPE,
    {
      counts: report.counts,
      similarity_threshold: report.similarity_threshold,
      min_lines: report.min_lines,
      mode: report.mode,
      blocking: report.blocking,
    },
    DUPLICATION_EVIDENCE_SCHEMA_VERSION,
  );
}
