// Session-id resolution for the session-scoped evidence ledgers (issue #249).
//
// On a host that supplies a session id (Claude passes one on hook stdin), use it. Else
// lazily mint a `ses_<ulid>` and cache it under `.paqad/session/`, so the background
// worker and the prompt seam agree on one id for the whole machine-local session. The
// id is never authored by the LLM.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { ulid } from '@/core/ids/ulid.js';

/** Resolve a session id: the host hint when present, else the cached/minted local id. */
export function resolveSessionId(projectRoot: string, hint?: string | null): string {
  const cleaned = hint?.trim();
  if (cleaned) {
    return cleaned;
  }
  const path = join(projectRoot, PATHS.LEDGER_SESSION_ID);
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) {
      return existing;
    }
  } catch {
    // No cached id yet — mint one below.
  }
  const minted = `ses_${ulid().toLowerCase()}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, minted, 'utf8');
  } catch {
    // Best-effort cache; a write failure just means the next call re-mints.
  }
  return minted;
}
