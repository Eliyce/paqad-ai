// Leaf helper for decoding a receipt envelope's wrapped in-toto Statement.
//
// Extracted from `project.ts` (issue #468 Phase B) so the per-feature receipt readers in
// `src/feature-evidence/receipt.ts` can decode a receipt WITHOUT importing `project.ts`,
// which would import them back (a cycle). This module depends only on the shared types, so
// nothing imports it in a cycle. `project.ts` re-exports `decodeReceiptStatement` from here,
// so every existing importer keeps working unchanged.

import { type InTotoStatement, type ReceiptEnvelope } from '@/core/types/evidence-ledger.js';

/**
 * Decode a receipt envelope's wrapped in-toto Statement, or `null` when the base64 payload
 * is unparseable.
 */
export function decodeReceiptStatement(envelope: ReceiptEnvelope): InTotoStatement | null {
  try {
    return JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as InTotoStatement;
  } catch {
    return null;
  }
}
