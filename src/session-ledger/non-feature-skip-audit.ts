import { resolveSessionId } from '@/rag-ledger/session.js';

import { currentOrdinal, openSessionDoc, type OpenSessionDocResult } from './ledger.js';

export const NON_FEATURE_SKIP_DOC_TYPE = 'non-feature-verification-skip';
export const NON_FEATURE_SKIP_SCHEMA_VERSION = 1 as const;

export type NonFeatureSkipReason = 'non-feature-route' | 'not-owner' | 'detour';

export interface RecordNonFeatureSkipContext {
  sessionId?: string | null;
  workflow?: string | null;
  origin?: string;
  reason?: NonFeatureSkipReason;
  adapter?: string;
  now?: () => Date;
}

export function recordNonFeatureVerificationSkip(
  projectRoot: string,
  ctx: RecordNonFeatureSkipContext = {},
): OpenSessionDocResult | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    if (currentOrdinal(projectRoot, NON_FEATURE_SKIP_DOC_TYPE, sessionId) > 0) {
      return null;
    }
    return openSessionDoc(
      projectRoot,
      NON_FEATURE_SKIP_DOC_TYPE,
      sessionId,
      {
        reason: ctx.reason ?? 'non-feature-route',
        workflow: ctx.workflow ?? 'unknown',
        origin: ctx.origin ?? 'unknown',
        adapter: ctx.adapter ?? 'unknown',
      },
      { schemaVersion: NON_FEATURE_SKIP_SCHEMA_VERSION, now: ctx.now },
    );
  } catch {
    return null;
  }
}
