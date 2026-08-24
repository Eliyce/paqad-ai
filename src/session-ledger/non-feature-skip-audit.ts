// Non-feature verification-skip audit (issue #499).
//
// When the completion backstop short-circuits because the session never routed to
// feature-development, the skip must be OBSERVABLE — never silent. This records ONE
// row on the shared session-ledger so the bypass shows up in the dashboard / SIEM
// export, mirroring the disabled-session audit (buildout F2b): same substrate, same
// once-per-session, best-effort contract — auditing the skip must never break the
// verification path it rides. It carries the routed workflow so the trail says WHICH
// non-feature workflow the turn ran.

import { resolveSessionId } from '@/rag-ledger/session.js';

import { currentOrdinal, openSessionDoc, type OpenSessionDocResult } from './ledger.js';

export const NON_FEATURE_SKIP_DOC_TYPE = 'non-feature-verification-skip';
export const NON_FEATURE_SKIP_SCHEMA_VERSION = 1 as const;

export interface RecordNonFeatureSkipContext {
  /** Host session id hint (Claude threads one on hook stdin); else cache/mint. */
  sessionId?: string | null;
  /** The routed workflow that owed no verification (e.g. `project-question`). */
  workflow?: string | null;
  /** Where the skip was observed (always `hook-completion` today). */
  origin?: string;
  /** Host adapter, when known. */
  adapter?: string;
  /** Clock seam for tests. */
  now?: () => Date;
}

/**
 * Record that a completion turn skipped verification because the session was a
 * non-feature workflow — once per session. Returns the open-doc result on the first
 * record, or null when already recorded for this session or on any failure
 * (best-effort; never throws).
 */
export function recordNonFeatureVerificationSkip(
  projectRoot: string,
  ctx: RecordNonFeatureSkipContext = {},
): OpenSessionDocResult | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    // Once per session: a non-feature session is one audit row, not one per turn.
    if (currentOrdinal(projectRoot, NON_FEATURE_SKIP_DOC_TYPE, sessionId) > 0) {
      return null;
    }
    return openSessionDoc(
      projectRoot,
      NON_FEATURE_SKIP_DOC_TYPE,
      sessionId,
      {
        reason: 'non-feature-route',
        workflow: ctx.workflow ?? 'unknown',
        origin: ctx.origin ?? 'unknown',
        adapter: ctx.adapter ?? 'unknown',
      },
      { schemaVersion: NON_FEATURE_SKIP_SCHEMA_VERSION, now: ctx.now },
    );
  } catch {
    // Best-effort: the skip must work even if the audit cannot.
    return null;
  }
}
