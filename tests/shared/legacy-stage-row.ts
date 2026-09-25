// Test helper: write a stage-evidence row in the pre-#581 (schema version 1) shape.
//
// Writers only produce the current shape (INV-9), so a test that proves a reader still
// accepts an OLD bundle (INV-8) has to put the old row on disk itself. This is that row:
// `schema_version: 1`, a `ts`, and the session constants (`adapter`, `lane`, `branch`) that
// rows used to carry, hashed with the same row-identity hash the ledger uses.

import {
  appendStampedRowToUnit,
  computeSessionRowHash,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

export function appendLegacyStageRow(
  root: string,
  dirName: string,
  sessionId: string,
  fields: Record<string, unknown>,
  ts = '2026-07-19T00:00:00.000Z',
): SessionLedgerRow {
  const base: Record<string, unknown> = {
    schema_version: 1,
    doc_type: STAGE_EVIDENCE_DOC_TYPE,
    session_id: sessionId,
    conversation_ordinal: 1,
    adapter: 'claude-code',
    agent: 'orchestrator',
    ...fields,
  };
  const row = { ...base, ts, content_hash: computeSessionRowHash(base) } as SessionLedgerRow;
  appendStampedRowToUnit(root, featureFilePath(dirName, 'stageEvidence'), row);
  return row;
}
