import { resolveSessionId } from '@/rag-ledger/session.js';

import { currentOrdinal, openSessionDoc, type OpenSessionDocResult } from './ledger.js';

export const DISABLED_SESSION_DOC_TYPE = 'disabled-session';
export const DISABLED_SESSION_SCHEMA_VERSION = 1 as const;

export interface RecordDisabledSessionContext {
  sessionId?: string | null;
  origin?: string;
  adapter?: string;
  now?: () => Date;
}

export function recordDisabledSession(
  projectRoot: string,
  ctx: RecordDisabledSessionContext = {},
): OpenSessionDocResult | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
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
    return null;
  }
}
