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

/**
 * Persist a KNOWN host session id to the single-slot ledger-session cache, without
 * minting (issue #380, Issue 1 — extend "bug #5" from finalization to bundle minting).
 *
 * The SessionStart hook calls this with the live host session id so the machine-local
 * cache is aligned to the current session BEFORE the agent runs anything. Without it, a
 * shell `paqad-ai stage start --title` invoked before the first edit resolves the cache
 * — which may still hold a PRIOR session's id — and mints its feature bundle under that
 * stale session, while the PreToolUse gate keys on the true host id: the bundle and the
 * gate disagree, orphaning the bundle and blocking the edit.
 *
 * Returns true when a non-empty id was written, false otherwise (no id → nothing to
 * align; never mints here). Best-effort: a write failure is swallowed — the next hook
 * that carries the host id re-aligns the cache.
 */
export function persistLedgerSessionId(projectRoot: string, sessionId?: string | null): boolean {
  const cleaned = sessionId?.trim();
  if (!cleaned) return false;
  try {
    const path = join(projectRoot, PATHS.LEDGER_SESSION_ID);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, cleaned, 'utf8');
    return true;
    /* v8 ignore next 4 -- best-effort cache write; a fs failure is not reproduced in tests */
  } catch {
    return false;
  }
}

/** Resolve a session id: the host hint when present, else the cached/minted local id. */
export function resolveSessionId(projectRoot: string, hint?: string | null): string {
  const path = join(projectRoot, PATHS.LEDGER_SESSION_ID);
  const cleaned = hint?.trim();
  if (cleaned) {
    // Persist the host id to the single-slot cache so a later no-hint reader (the
    // completion-seam fallback) resolves the SAME id instead of a stale one from a
    // prior/engine run — parity with the .mjs `resolveSeamSessionId` (buildout F5b,
    // bug #5). Best-effort: a write failure just means the next call re-reads.
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, cleaned, 'utf8');
      /* v8 ignore next 3 -- best-effort cache write; a fs failure is not reproduced in tests */
    } catch {
      // Best-effort cache refresh; resolution still returns the host id.
    }
    return cleaned;
  }
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
    /* v8 ignore next 3 -- best-effort cache write; a fs failure is not reproduced in tests */
  } catch {
    // Best-effort cache; a write failure just means the next call re-mints.
  }
  return minted;
}
