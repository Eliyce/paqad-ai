import { describe, expect, it } from 'vitest';

import type { InTotoStatement } from '@/core/types/evidence-ledger.js';
import { ZERO_DIGEST } from '@/evidence/digests.js';
import { buildInTotoStatement } from '@/evidence/receipt/statement.js';
import {
  DSSE_PAYLOAD_TYPE,
  detectSigningMode,
  pae,
  signReceipt,
  verifyReceiptChain,
  verifyReceiptSeal,
} from '@/evidence/receipt/dsse.js';

function statement(version = '1.0.0'): InTotoStatement {
  return buildInTotoStatement({
    fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
    rows: [],
    verifierVersion: version,
    timeVerified: '2026-06-11T00:00:00.000Z',
  });
}

describe('pae', () => {
  it('follows the DSSE PAE layout', () => {
    expect(pae('t', Buffer.from('body')).toString('utf8')).toBe('DSSEv1 1 t 4 body');
  });
});

describe('verifyReceiptSeal', () => {
  it('is true iff the receipt_hash recomputes from its own PAE + prev (#468 AC-7)', () => {
    const genesis = signReceipt({ statement: statement(), mode: 'hash-chained' });
    expect(verifyReceiptSeal(genesis)).toBe(true);
    // A non-genesis receipt whose prev is some prior hash still self-verifies in isolation,
    // even though verifyReceiptChain (which also checks linkage) would reject it as element 0.
    const chained = signReceipt({
      statement: statement(),
      prevReceiptHash: 'a'.repeat(64),
      mode: 'hash-chained',
    });
    expect(verifyReceiptSeal(chained)).toBe(true);
    expect(verifyReceiptChain([chained])).toBe(0); // linkage fails at genesis
    // Tampering the recorded hash breaks the seal.
    const tampered = { ...genesis, paqad: { ...genesis.paqad, receipt_hash: 'f'.repeat(64) } };
    expect(verifyReceiptSeal(tampered)).toBe(false);
  });
});

describe('detectSigningMode', () => {
  it('hash-chains locally', () => {
    expect(detectSigningMode({})).toBe('hash-chained');
  });
  it('intends keyless only in CI with explicit opt-in', () => {
    expect(detectSigningMode({ CI: 'true', PAQAD_SIGSTORE: '1' })).toBe('sigstore-keyless');
    expect(detectSigningMode({ CI: 'true' })).toBe('hash-chained');
  });
});

describe('signReceipt', () => {
  it('produces a DSSE envelope whose payload decodes to the statement', () => {
    const stmt = statement();
    const envelope = signReceipt({ statement: stmt, mode: 'hash-chained' });

    expect(envelope.payloadType).toBe(DSSE_PAYLOAD_TYPE);
    expect(JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'))).toEqual(stmt);
    expect(envelope.paqad.signing_mode).toBe('hash-chained');
    expect(envelope.paqad.prev_receipt_hash).toBe(ZERO_DIGEST);
    expect(envelope.signatures[0].keyid).toBe('paqad-hash-chain');
    expect(envelope.signatures[0].sig).toBe(envelope.paqad.receipt_hash);
  });

  it('never labels the local chain as a third-party signature', () => {
    const envelope = signReceipt({ statement: statement(), mode: 'sigstore-keyless' });
    expect(envelope.paqad.signing_mode).toBe('hash-chained');
  });
});

describe('verifyReceiptChain', () => {
  it('accepts an intact chain and links each receipt to the previous', () => {
    const first = signReceipt({ statement: statement('1'), mode: 'hash-chained' });
    const second = signReceipt({
      statement: statement('2'),
      prevReceiptHash: first.paqad.receipt_hash,
      mode: 'hash-chained',
    });
    expect(second.paqad.prev_receipt_hash).toBe(first.paqad.receipt_hash);
    expect(verifyReceiptChain([first, second])).toBeNull();
  });

  it('flags the index of a tampered receipt', () => {
    const first = signReceipt({ statement: statement('1'), mode: 'hash-chained' });
    const second = signReceipt({
      statement: statement('2'),
      prevReceiptHash: first.paqad.receipt_hash,
      mode: 'hash-chained',
    });
    // Retroactively edit the first receipt's payload — its recorded hash no
    // longer recomputes, so the chain breaks at index 0.
    const tampered = { ...first, payload: Buffer.from('{"_type":"evil"}').toString('base64') };
    expect(verifyReceiptChain([tampered, second])).toBe(0);
  });
});
