import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import { RECORD_REPAIR_KIND } from './types.js';

export const REPORT_REPAIR_REASON = 'report read from handback after the parser fix';

export interface RepairedReport {
  agent_id: string;
  stages: string[];
  report_status: string;
  source: string;
}

const ENTRY =
  /^(\S+) ([a-z_+]+): (DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED) \((handback|text)\)$/u;

export function reportRepairNote(entry: RepairedReport): string {
  return `${entry.agent_id} ${entry.stages.join('+')}: ${entry.report_status} (${entry.source})`;
}

export function isReportRepairRow(row: SessionLedgerRow): boolean {
  return row.kind === RECORD_REPAIR_KIND && row.reason === REPORT_REPAIR_REASON;
}

export function readRepairedReports(rows: readonly SessionLedgerRow[]): RepairedReport[] {
  const byAgent = new Map<string, RepairedReport>();
  for (const row of rows) {
    if (!isReportRepairRow(row) || typeof row.note !== 'string') continue;
    for (const part of row.note.split('; ')) {
      const match = ENTRY.exec(part.trim());
      if (match === null) continue;
      byAgent.set(match[1]!, {
        agent_id: match[1]!,
        stages: match[2]!.split('+'),
        report_status: match[3]!,
        source: match[4]!,
      });
    }
  }
  return [...byAgent.values()];
}
