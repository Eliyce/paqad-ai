import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

export type LedgerEra = 'v3' | 'legacy';

const CHAINED_VERSION = 3;

export function bundleLedgerEra(rows: readonly SessionLedgerRow[]): LedgerEra {
  return rows[0]?.schema_version === CHAINED_VERSION ? 'v3' : 'legacy';
}

export function stageLedgerEra(rows: readonly SessionLedgerRow[], stage: string): LedgerEra {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === 'stage_start' && row.stage === stage) {
      return row.schema_version === CHAINED_VERSION ? 'v3' : 'legacy';
    }
  }
  return 'legacy';
}
