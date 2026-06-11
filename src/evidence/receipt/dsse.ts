// Issue #118 — wrap the in-toto Statement in a DSSE envelope and sign it.
//
// Honest local-first signing: Sigstore keyless (Fulcio/Rekor) assumes a CI OIDC
// identity and a public transparency log, so it only works in CI. Locally there
// is no third party to anchor a signature, so "signed" degrades — explicitly —
// to a tamper-evident **hash chain**: each receipt embeds the SHA-256 of the
// previous receipt's PAE, so any retroactive edit to an earlier receipt breaks
// every later link. We never dress a hash chain up as a third-party signature.

import { createHash } from 'node:crypto';

import {
  type InTotoStatement,
  type ReceiptEnvelope,
  type ReceiptSigningMode,
} from '@/core/types/evidence-ledger.js';

import { ZERO_DIGEST } from '../digests.js';

/** DSSE payload type for an in-toto Statement. */
export const DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';

/**
 * DSSE Pre-Authentication Encoding (PAE) — the exact bytes a DSSE signature is
 * computed over: `DSSEv1 <len(type)> <type> <len(body)> <body>`. Computing the
 * hash chain over the PAE (not the raw payload) keeps us aligned with what a
 * real signature would cover, so swapping in Sigstore later changes only the
 * signer, not the signed bytes.
 */
export function pae(payloadType: string, payload: Buffer): Buffer {
  const typeBytes = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${typeBytes.length} `, 'utf8'),
    typeBytes,
    Buffer.from(` ${payload.length} `, 'utf8'),
    payload,
  ]);
}

/** Canonical Statement bytes — stable key order via JSON.stringify of the
 *  builder's output (we never re-sort, so the builder owns field order). */
export function statementPayload(statement: InTotoStatement): Buffer {
  return Buffer.from(JSON.stringify(statement), 'utf8');
}

/**
 * Decide how to sign. Sigstore keyless needs a CI OIDC identity; absent that we
 * hash-chain. We detect CI conservatively and require an explicit opt-in
 * (`PAQAD_SIGSTORE=1`) because actually reaching Fulcio/Rekor needs network and
 * the cosign toolchain — we never *claim* a keyless signature we didn't obtain.
 */
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

/**
 * Produce the DSSE envelope. In `hash-chained` mode the single "signature" is
 * the chain link itself (clearly keyed `paqad-hash-chain`), so a consumer can
 * never mistake it for an asymmetric signature. The `sigstore-keyless` branch is
 * intentionally not implemented inline — reaching Fulcio/Rekor is out of scope
 * for this issue (it belongs with the CI signer) — so we fall back and record
 * the honest mode rather than emitting a fake keyless signature.
 */
export function signReceipt(input: SignReceiptInput): ReceiptEnvelope {
  const payload = statementPayload(input.statement);
  const encoded = pae(DSSE_PAYLOAD_TYPE, payload);
  const prev = input.prevReceiptHash ?? ZERO_DIGEST;

  // Chain link: hash of this receipt's PAE folded with the previous link.
  const receiptHash = createHash('sha256').update(encoded).update(prev).digest('hex');

  // Sigstore keyless is not obtainable here; degrade honestly to hash-chained.
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

/**
 * Verify a receipt chain is intact: each receipt's recorded `receipt_hash` must
 * recompute from its own PAE + the previous link, and `prev_receipt_hash` must
 * equal the prior receipt's `receipt_hash` (genesis = {@link ZERO_DIGEST}).
 * Returns the index of the first broken link, or `null` when the chain is sound.
 */
export function verifyReceiptChain(envelopes: readonly ReceiptEnvelope[]): number | null {
  let prev = ZERO_DIGEST;
  for (let i = 0; i < envelopes.length; i += 1) {
    const envelope = envelopes[i];
    if (envelope.paqad.prev_receipt_hash !== prev) return i;
    const payload = Buffer.from(envelope.payload, 'base64');
    const encoded = pae(envelope.payloadType, payload);
    const expected = createHash('sha256').update(encoded).update(prev).digest('hex');
    if (envelope.paqad.receipt_hash !== expected) return i;
    prev = envelope.paqad.receipt_hash;
  }
  return null;
}
