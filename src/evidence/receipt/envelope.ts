import { type InTotoStatement, type ReceiptEnvelope } from '@/core/types/evidence-ledger.js';

export function decodeReceiptStatement(envelope: ReceiptEnvelope): InTotoStatement | null {
  try {
    return JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as InTotoStatement;
  } catch {
    return null;
  }
}
