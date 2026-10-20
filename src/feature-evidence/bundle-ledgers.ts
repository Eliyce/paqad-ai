import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { readEvidenceRowsAt } from '@/evidence/ledger.js';
import {
  allocateOrdinal,
  appendStampedRowToUnit,
  currentOrdinal,
  readUnitFile,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import type { ChangeMetrics } from '@/change-metrics/types.js';
import type { DuplicationReport } from '@/duplication/report.js';
import type { DuplicationFinding } from '@/duplication/types.js';

import { ENVELOPE_HEADER_KEYS, stampBundleRow } from './envelope.js';
import { chatRagPath, featureChangeKey, featureFilePath } from './paths.js';
import { currentFeature } from './stage-ledger.js';

export const RULE_RUN_DOC_TYPE = 'paqad.rule-run';
export const RULE_RUN_SCHEMA_VERSION = 2;

export const DUPLICATION_RUN_DOC_TYPE = 'paqad.duplication';
export const DUPLICATION_RUN_SCHEMA_VERSION = 2;

export const CHANGE_METRICS_RUN_DOC_TYPE = 'paqad.change-metrics';
export const CHANGE_METRICS_RUN_SCHEMA_VERSION = 2;

export const BUNDLE_RAG_DOC_TYPE = 'paqad.rag';
export const BUNDLE_RAG_SCHEMA_VERSION = 2;

export const BUNDLE_EVIDENCE_DOC_TYPE = 'paqad.evidence';
export const BUNDLE_EVIDENCE_SCHEMA_VERSION = 2;

const ROW_HEADER_KEYS: ReadonlySet<string> = new Set([...ENVELOPE_HEADER_KEYS, 'ts']);

function rowBody(
  row: Record<string, unknown>,
  drop: readonly string[] = [],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !ROW_HEADER_KEYS.has(key) && !drop.includes(key)),
  );
}

function stampFeatureRow(
  dirName: string,
  sessionId: string,
  docType: string,
  schemaVersion: number,
  row: Record<string, unknown>,
  now?: () => Date,
): SessionLedgerRow {
  return stampBundleRow({
    docType,
    change: featureChangeKey(dirName),
    sessionId,
    schemaVersion,
    row,
    now,
  }) as unknown as SessionLedgerRow;
}

export function resolveRagHome(projectRoot: string, sessionId: string): string {
  const dirName = currentFeature(projectRoot, sessionId);
  return dirName ? featureFilePath(dirName, 'rag') : chatRagPath(sessionId);
}

const CHAT_ORDINAL_DOC = '_chat';

export function allocateChatOrdinal(projectRoot: string, sessionId: string): number {
  return allocateOrdinal(projectRoot, CHAT_ORDINAL_DOC, sessionId);
}

export function currentChatOrdinal(projectRoot: string, sessionId: string): number {
  return currentOrdinal(projectRoot, CHAT_ORDINAL_DOC, sessionId);
}

export function mirrorRagRow(
  projectRoot: string,
  sessionId: string,
  stampedRow: SessionLedgerRow,
): void {
  try {
    const dirName = currentFeature(projectRoot, sessionId);
    if (!dirName) {
      appendStampedRowToUnit(projectRoot, chatRagPath(sessionId), stampedRow);
      return;
    }
    const bundleRow = stampFeatureRow(
      dirName,
      sessionId,
      BUNDLE_RAG_DOC_TYPE,
      BUNDLE_RAG_SCHEMA_VERSION,
      rowBody(stampedRow, ['adapter']),
      () => new Date(stampedRow.ts),
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'rag'), bundleRow);
  } catch {}
}

export const BUNDLE_FINDINGS_CAP = 50;

export interface RuleRunFinding {
  rule_id: string;
  file: string;
  line: number | null;
  message: string;
  severity: string;
}

export interface DuplicationRowFinding {
  file: string;
  line_range: { start: number; end: number };
  matched_file: string;
  matched_symbol: string | null;
  matched_line_range: { start: number; end: number };
  similarity: number;
  matched_callers: number;
  kind: 'deterministic' | 'heuristic';
}

function duplicationRowFinding(finding: DuplicationFinding): DuplicationRowFinding {
  return {
    file: finding.file,
    line_range: finding.line_range,
    matched_file: finding.matched_file,
    matched_symbol: finding.matched_symbol ?? null,
    matched_line_range: finding.matched_line_range,
    similarity: finding.similarity,
    matched_callers: finding.matched_callers,
    kind: finding.kind,
  };
}

function capFindings<T>(all: readonly T[]): { findings: T[]; findings_overflow: number } {
  return {
    findings: all.slice(0, BUNDLE_FINDINGS_CAP),
    findings_overflow: Math.max(0, all.length - BUNDLE_FINDINGS_CAP),
  };
}

export interface RuleRunEntry {
  kind: 'findings' | 'drift';
  counts: Record<string, number>;
  blocking: boolean;
  note?: string | null;
  backfilled?: boolean;
  findings?: readonly RuleRunFinding[];
  from_cache?: boolean;
  now?: () => Date;
}

export function appendRuleRun(
  projectRoot: string,
  sessionId: string,
  entry: RuleRunEntry,
): SessionLedgerRow | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  try {
    const payload = {
      kind: entry.kind,
      counts: entry.counts,
      blocking: entry.blocking,
      note: entry.note ?? null,
      ...(entry.findings ? capFindings(entry.findings) : {}),
      ...(entry.from_cache ? { from_cache: true } : {}),
      ...(entry.backfilled ? { backfilled: true } : {}),
    };
    if (entry.from_cache && repeatsLastRuleRun(projectRoot, dirName, payload)) {
      return null;
    }
    const stamped = stampFeatureRow(
      dirName,
      sessionId,
      RULE_RUN_DOC_TYPE,
      RULE_RUN_SCHEMA_VERSION,
      payload,
      entry.now,
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'ruleRun'), stamped);
    return stamped;
  } catch {
    return null;
  }
}

function repeatsLastRuleRun(
  projectRoot: string,
  dirName: string,
  payload: Record<string, unknown>,
): boolean {
  const last = readRuleRun(projectRoot, dirName).at(-1);
  if (!last) return false;
  const keys = new Set([...Object.keys(payload), 'findings', 'findings_overflow', 'backfilled']);
  return [...keys].every((key) => JSON.stringify(last[key]) === JSON.stringify(payload[key]));
}

export function readRuleRun(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'ruleRun'));
}

export function appendDuplicationRun(
  projectRoot: string,
  sessionId: string,
  report: DuplicationReport,
  now?: () => Date,
  backfilled = false,
): SessionLedgerRow | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  try {
    const stamped = stampFeatureRow(
      dirName,
      sessionId,
      DUPLICATION_RUN_DOC_TYPE,
      DUPLICATION_RUN_SCHEMA_VERSION,
      {
        counts: report.counts,
        similarity_threshold: report.similarity_threshold,
        min_lines: report.min_lines,
        mode: report.mode,
        blocking: report.blocking,
        ...(Array.isArray(report.findings)
          ? capFindings(report.findings.map(duplicationRowFinding))
          : {}),
        ...(backfilled ? { backfilled: true } : {}),
      },
      now,
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'duplication'), stamped);
    return stamped;
  } catch {
    return null;
  }
}

export function readDuplication(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'duplication'));
}

export function appendChangeMetrics(
  projectRoot: string,
  sessionId: string,
  metrics: ChangeMetrics,
  now?: () => Date,
  backfilled = false,
): SessionLedgerRow | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  try {
    const stamped = stampFeatureRow(
      dirName,
      sessionId,
      CHANGE_METRICS_RUN_DOC_TYPE,
      CHANGE_METRICS_RUN_SCHEMA_VERSION,
      {
        dup_new_pct: metrics.dup_new_pct,
        reuse_rate: metrics.reuse_rate,
        meaningful_changed_lines: metrics.meaningful_changed_lines,
        flagged_lines: metrics.inputs.flagged_lines,
        reuse_calls: metrics.inputs.reuse_calls,
        ...(backfilled ? { backfilled: true } : {}),
      },
      now,
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'changeMetrics'), stamped);
    return stamped;
  } catch {
    return null;
  }
}

export function readChangeMetrics(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'changeMetrics'));
}

export function appendFeatureEvidenceRows(
  projectRoot: string,
  sessionId: string,
  rows: readonly EvidenceLedgerRow[],
): EvidenceLedgerRow[] {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName || rows.length === 0) {
    return [];
  }
  try {
    const path = featureFilePath(dirName, 'evidence');
    const written: EvidenceLedgerRow[] = [];
    for (const row of rows) {
      const stamped = stampFeatureRow(
        dirName,
        sessionId,
        BUNDLE_EVIDENCE_DOC_TYPE,
        BUNDLE_EVIDENCE_SCHEMA_VERSION,
        rowBody(row as unknown as Record<string, unknown>),
        () => new Date(row.ts),
      );
      appendStampedRowToUnit(projectRoot, path, stamped);
      written.push({ ...(stamped as unknown as EvidenceLedgerRow), ts: row.ts });
    }
    return written;
  } catch {
    return [];
  }
}

export function readFeatureEvidence(projectRoot: string, dirName: string): EvidenceLedgerRow[] {
  return readEvidenceRowsAt(projectRoot, featureFilePath(dirName, 'evidence'));
}
