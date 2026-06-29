// Disabled-session audit (buildout F2b — decision D1, the visible-bypass half).
//
// PAQAD_DISABLED (and a `paqad_enable=false` config) turn paqad into a pure no-op:
// no gates run, nothing is recorded — so a team has no signal that a session ran
// with enforcement OFF. D1 keeps the disable escape hatch but makes every use of
// it AUDITABLE: when a session completes while disabled, record ONE row on the
// shared session-ledger so the bypass shows up in the dashboard / SIEM export
// (the ledger is the per-machine evidence surface, shared there — not via git).
//
// Best-effort and once-per-session: auditing a disabled session must never break
// anything, and a session is recorded once (not once per turn). Lives on the #249
// session-ledger substrate under its own `disabled-session` doc_type.

import { resolveSessionId } from '@/rag-ledger/session.js';

import { currentOrdinal, openSessionDoc, type OpenSessionDocResult } from './ledger.js';

export const DISABLED_SESSION_DOC_TYPE = 'disabled-session';
export const DISABLED_SESSION_SCHEMA_VERSION = 1 as const;

export interface RecordDisabledSessionContext {
  /** Host session id hint (Claude threads one on hook stdin); else cache/mint. */
  sessionId?: string | null;
  /** Where the disabled session was observed (e.g. `hook-completion`). */
  origin?: string;
  /** Host adapter, when known. */
  adapter?: string;
  /** Clock seam for tests. */
  now?: () => Date;
}

/**
 * Record that a session ran while paqad was disabled — once per session. Returns
 * the open-doc result on the first record, or null when already recorded for this
 * session or on any failure (best-effort; never throws).
 */
export function recordDisabledSession(
  projectRoot: string,
  ctx: RecordDisabledSessionContext = {},
): OpenSessionDocResult | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    // Once per session: a disabled session is one audit row, not one per turn.
    if (currentOrdinal(projectRoot, DISABLED_SESSION_DOC_TYPE, sessionId) > 0) {
      return null;
    }
    return openSessionDoc(
      projectRoot,
      DISABLED_SESSION_DOC_TYPE,
      sessionId,
      {
        reason: 'paqad-disabled',
        origin: ctx.origin ?? 'unknown',
        adapter: ctx.adapter ?? 'unknown',
      },
      { schemaVersion: DISABLED_SESSION_SCHEMA_VERSION, now: ctx.now },
    );
  } catch {
    // Best-effort: the disable escape hatch must work even if the audit cannot.
    return null;
  }
}
