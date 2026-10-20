import { resolveSessionId } from '@/rag-ledger/session.js';
import { openSessionDoc, type OpenSessionDocResult } from '@/session-ledger/ledger.js';

export const SITE_MAP_RUN_DOC_TYPE = 'site-map-run';
export const SITE_MAP_RUN_SCHEMA_VERSION = 1 as const;

export interface SiteMapRunLedgerSummary {
  report_id: string;
  workflow: string;
  surface_count: number;
  journey_count: number;
  finding_count: number;
  blocked_count: number;
  new_since_baseline: number;
  pre_existing: number;
}

export interface RecordSiteMapRunContext {
  sessionId?: string | null;
  now?: () => Date;
}

export function recordSiteMapRun(
  projectRoot: string,
  summary: SiteMapRunLedgerSummary,
  ctx: RecordSiteMapRunContext = {},
): OpenSessionDocResult | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    return openSessionDoc(
      projectRoot,
      SITE_MAP_RUN_DOC_TYPE,
      sessionId,
      {
        kind: 'run',
        report_id: summary.report_id,
        workflow: summary.workflow,
        surface_count: summary.surface_count,
        journey_count: summary.journey_count,
        finding_count: summary.finding_count,
        blocked_count: summary.blocked_count,
        new_since_baseline: summary.new_since_baseline,
        pre_existing: summary.pre_existing,
        event_status: summary.finding_count > 0 ? 'findings' : 'clean',
      },
      { schemaVersion: SITE_MAP_RUN_SCHEMA_VERSION, now: ctx.now },
    );
  } catch {
    return null;
  }
}

export const SITE_MAP_JOURNEY_CURATION_DOC_TYPE = 'site-map-journey-curation';

export interface JourneyCurationLedgerSummary {
  journey_id: string;
  action: string;
  status: string;
}

export function recordJourneyCuration(
  projectRoot: string,
  summary: JourneyCurationLedgerSummary,
  ctx: RecordSiteMapRunContext = {},
): OpenSessionDocResult | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    return openSessionDoc(
      projectRoot,
      SITE_MAP_JOURNEY_CURATION_DOC_TYPE,
      sessionId,
      {
        kind: 'curation',
        journey_id: summary.journey_id,
        action: summary.action,
        status: summary.status,
        event_status: summary.action === 'confirm' ? 'confirmed' : 'rejected',
      },
      { schemaVersion: SITE_MAP_RUN_SCHEMA_VERSION, now: ctx.now },
    );
  } catch {
    return null;
  }
}
