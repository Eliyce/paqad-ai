import { createHash } from 'node:crypto';

import {
  type InTotoStatement,
  type ReceiptEnvelope,
  type ReceiptSigningMode,
} from '@/core/types/evidence-ledger.js';

import { ZERO_DIGEST } from '../digests.js';

export const DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';

export function pae(payloadType: string, payload: Buffer): Buffer {
  const typeBytes = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${typeBytes.length} `, 'utf8'),
    typeBytes,
    Buffer.from(` ${payload.length} `, 'utf8'),
    payload,
  ]);
}

export function statementPayload(statement: InTotoStatement): Buffer {
  return Buffer.from(JSON.stringify(statement), 'utf8');
}

export function detectSigningMode(env: NodeJS.ProcessEnv): ReceiptSigningMode {
  const inCi = env.CI === 'true' || env.CI === '1';
  const optedIn = env.PAQAD_SIGSTORE === '1' || env.PAQAD_SIGSTORE === 'true';
  return inCi && optedIn ? 'sigstore-keyless' : 'hash-chained';
}

export interface SignReceiptInput {
  statement: InTotoStatement;
  prevReceiptHash?: string;
  mode: ReceiptSigningMode;
}

export function signReceipt(input: SignReceiptInput): ReceiptEnvelope {
  const payload = statementPayload(input.statement);
  const encoded = pae(DSSE_PAYLOAD_TYPE, payload);
  const prev = input.prevReceiptHash ?? ZERO_DIGEST;

  const receiptHash = createHash('sha256').update(encoded).update(prev).digest('hex');

  const signingMode: ReceiptSigningMode = 'hash-chained';

  return {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString('base64'),
    signatures: [{ keyid: 'paqad-hash-chain', sig: receiptHash }],
    paqad: {
      signing_mode: signingMode,
      prev_receipt_hash: prev,
      receipt_hash: receiptHash,
    },
  };
}

export function verifyReceiptSeal(envelope: ReceiptEnvelope): boolean {
  const payload = Buffer.from(envelope.payload, 'base64');
  const encoded = pae(envelope.payloadType, payload);
  const expected = createHash('sha256')
    .update(encoded)
    .update(envelope.paqad.prev_receipt_hash)
    .digest('hex');
  return envelope.paqad.receipt_hash === expected;
}

export function verifyReceiptChain(envelopes: readonly ReceiptEnvelope[]): number | null {
  let prev = ZERO_DIGEST;
  for (let i = 0; i < envelopes.length; i += 1) {
    const envelope = envelopes[i];
    if (envelope.paqad.prev_receipt_hash !== prev) return i;
    if (!verifyReceiptSeal(envelope)) return i;
    prev = envelope.paqad.receipt_hash;
  }
  return null;
}
