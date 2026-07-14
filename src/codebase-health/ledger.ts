// Records a one-row summary of each health run on the shared session-ledger, so
// run summaries auto-flow into `paqad-ai audit export` (SIEM) alongside the other
// doc types. Best-effort: recording must never break a run.

import { resolveSessionId } from '@/rag-ledger/session.js';
import { openSessionDoc, type OpenSessionDocResult } from '@/session-ledger/ledger.js';

export const HEALTH_RUN_DOC_TYPE = 'codebase-health-run';
export const HEALTH_RUN_SCHEMA_VERSION = 1 as const;

export interface HealthRunLedgerSummary {
  report_id: string;
  workflow: string;
  offline: boolean;
  finding_count: number;
  blocked_count: number;
  new_since_baseline: number;
  pre_existing: number;
}

export interface RecordHealthRunContext {
  sessionId?: string | null;
  now?: () => Date;
}

/** Record a health-run summary row. Returns the open-doc result, or null on failure. */
export function recordHealthRun(
  projectRoot: string,
  summary: HealthRunLedgerSummary,
  ctx: RecordHealthRunContext = {},
): OpenSessionDocResult | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    return openSessionDoc(
      projectRoot,
      HEALTH_RUN_DOC_TYPE,
      sessionId,
      {
        kind: 'run',
        report_id: summary.report_id,
        workflow: summary.workflow,
        offline: summary.offline,
        finding_count: summary.finding_count,
        blocked_count: summary.blocked_count,
        new_since_baseline: summary.new_since_baseline,
        pre_existing: summary.pre_existing,
        event_status: summary.finding_count > 0 ? 'findings' : 'clean',
      },
      { schemaVersion: HEALTH_RUN_SCHEMA_VERSION, now: ctx.now },
    );
  } catch {
    return null;
  }
}
