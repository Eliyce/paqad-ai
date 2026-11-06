import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { readSessionDoc, type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { DECISION_REUSE_DOC_TYPE } from './types.js';

interface DecisionCounts {
  accepted: number;
  changed: number;
  none: number;
  standing: number;
}

function belongsToChange(row: SessionLedgerRow, change: string, startedAt: number): boolean {
  if (typeof row.change === 'string') return row.change === change;
  return Date.parse(String(row.ts)) >= startedAt;
}

function countRows(rows: readonly SessionLedgerRow[]): DecisionCounts {
  const counts: DecisionCounts = { accepted: 0, changed: 0, none: 0, standing: 0 };
  for (const row of rows) {
    if (row.kind === 'reuse' && row.match_kind === 'standing') counts.standing += 1;
    if (row.kind !== 'suggestion') continue;
    if (row.outcome === 'accepted') counts.accepted += 1;
    if (row.outcome === 'changed') counts.changed += 1;
    if (row.outcome === 'none') counts.none += 1;
  }
  return counts;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatDecisionsLine(counts: DecisionCounts): string | null {
  const suggested = counts.accepted + counts.changed;
  const parts: string[] = [];
  if (suggested > 0) {
    parts.push(
      `${plural(suggested, 'earlier answer', 'earlier answers')} suggested, ${counts.accepted} accepted, ${counts.changed} changed`,
    );
  }
  if (counts.none > 0) parts.push(`${counts.none} checked, none fit`);
  if (counts.standing > 0) {
    parts.push(`${plural(counts.standing, 'standing answer', 'standing answers')} used`);
  }
  return parts.length === 0 ? null : `decisions: ${parts.join('; ')}`;
}

export function decisionsReceiptLine(
  projectRoot: string,
  dirName: string,
  sessionId?: string | null,
): string | null {
  const feature = readFeatureRecord(projectRoot, dirName);
  if (feature === null) return null;
  const sessions = new Set([feature.session_id, ...(sessionId ? [sessionId] : [])]);
  const change = featureChangeKey(dirName);
  const startedAt = Date.parse(feature.recorded_at);
  const rows = [...sessions]
    .flatMap((session) => readSessionDoc(projectRoot, DECISION_REUSE_DOC_TYPE, session))
    .filter((row) => belongsToChange(row, change, startedAt));
  return formatDecisionsLine(countRows(rows));
}
