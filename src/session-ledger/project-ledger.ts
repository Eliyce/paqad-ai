// Project-scoped evidence on the session-ledger (buildout F6).
//
// The #249 session-ledger is session-scoped, but several F6 stores are PROJECT
// snapshots (delivery detection, rule compliance, …) — regenerated per machine,
// not per conversation. They ride the same substrate under a project sentinel
// "session", appending one row per producer run; the latest matching row is the
// current state. This is the one helper those folds share, so the sentinel + the
// ensure-unit + latest-scan logic lives in exactly one place.

import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  readSessionDoc,
  type SessionLedgerRow,
} from './ledger.js';

/** Sentinel "session" for project-scoped (not conversation-scoped) evidence. */
const PROJECT_SESSION = '_project';

/** The project doc's single unit, opening it on first record. */
function ensureUnit(projectRoot: string, docType: string): number {
  const current = currentOrdinal(projectRoot, docType, PROJECT_SESSION);
  if (current > 0) {
    return current;
  }
  return openSessionDoc(projectRoot, docType, PROJECT_SESSION, {}).ordinal;
}

/**
 * Append one row to a project-scoped ledger doc. Best-effort — recording evidence
 * must never break the producer that emitted it.
 */
export function recordProjectEvent(
  projectRoot: string,
  docType: string,
  row: Record<string, unknown>,
  schemaVersion = 1,
): void {
  try {
    const ordinal = ensureUnit(projectRoot, docType);
    appendSessionEvent(projectRoot, docType, PROJECT_SESSION, ordinal, row, { schemaVersion });
  } catch {
    // Best-effort evidence write; the producer's own state is unaffected.
  }
}

/** The latest row in a project-scoped doc matching `match`, or null when none. */
export function readLatestProjectEvent(
  projectRoot: string,
  docType: string,
  match: (row: SessionLedgerRow) => boolean,
): SessionLedgerRow | null {
  const rows = readSessionDoc(projectRoot, docType, PROJECT_SESSION);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (match(rows[i])) {
      return rows[i];
    }
  }
  return null;
}
