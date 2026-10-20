import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  readSessionDoc,
  type SessionLedgerRow,
} from './ledger.js';

const PROJECT_SESSION = '_project';

function ensureUnit(projectRoot: string, docType: string): number {
  const current = currentOrdinal(projectRoot, docType, PROJECT_SESSION);
  if (current > 0) {
    return current;
  }
  return openSessionDoc(projectRoot, docType, PROJECT_SESSION, {}).ordinal;
}

export function recordProjectEvent(
  projectRoot: string,
  docType: string,
  row: Record<string, unknown>,
  schemaVersion = 1,
): void {
  try {
    const ordinal = ensureUnit(projectRoot, docType);
    appendSessionEvent(projectRoot, docType, PROJECT_SESSION, ordinal, row, { schemaVersion });
  } catch {}
}

export function readProjectEvents(projectRoot: string, docType: string): SessionLedgerRow[] {
  return readSessionDoc(projectRoot, docType, PROJECT_SESSION);
}

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
