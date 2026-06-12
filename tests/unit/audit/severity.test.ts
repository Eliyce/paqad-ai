import { describe, expect, it } from 'vitest';

import {
  cefSeverity,
  ecsOutcome,
  epochMs,
  eventMessage,
  ocsfSeverityId,
  ocsfStatusId,
} from '@/audit/severity';
import type { SiemEvent } from '@/audit/types';

describe('verdict mappings', () => {
  it.each([
    ['pass', 1],
    ['PASSED', 1],
    ['fail', 4],
    ['FAILED', 4],
    ['blocked', 3],
    ['inconclusive', 3],
    ['unknown', 0],
  ])('ocsfSeverityId(%s) = %i', (verdict, expected) => {
    expect(ocsfSeverityId(verdict)).toBe(expected);
  });

  it.each([
    ['pass', 1],
    ['PASSED', 1],
    ['fail', 2],
    ['FAILED', 2],
    ['blocked', 0],
  ])('ocsfStatusId(%s) = %i', (verdict, expected) => {
    expect(ocsfStatusId(verdict)).toBe(expected);
  });

  it.each([
    ['pass', 'success'],
    ['PASSED', 'success'],
    ['fail', 'failure'],
    ['FAILED', 'failure'],
    ['blocked', 'unknown'],
  ])('ecsOutcome(%s) = %s', (verdict, expected) => {
    expect(ecsOutcome(verdict)).toBe(expected);
  });

  it.each([
    ['pass', 2],
    ['PASSED', 2],
    ['fail', 8],
    ['FAILED', 8],
    ['blocked', 5],
    ['inconclusive', 5],
    ['unknown', 0],
  ])('cefSeverity(%s) = %i', (verdict, expected) => {
    expect(cefSeverity(verdict)).toBe(expected);
  });
});

describe('epochMs', () => {
  it('parses an ISO timestamp', () => {
    expect(epochMs('2026-06-11T00:00:00.000Z')).toBe(Date.parse('2026-06-11T00:00:00.000Z'));
  });

  it('returns 0 for an empty or unparseable timestamp', () => {
    expect(epochMs('')).toBe(0);
    expect(epochMs('nope')).toBe(0);
  });
});

describe('eventMessage', () => {
  it('summarizes an evidence event with engine and grade', () => {
    const e: SiemEvent = {
      kind: 'evidence',
      ts: 't',
      engine: 'verification-gate',
      code: 'mutation-testing',
      verdict: 'pass',
      strength_class: 'deterministic',
    };
    expect(eventMessage(e)).toBe('verification-gate mutation-testing: pass [deterministic]');
  });

  it('omits engine and grade when absent', () => {
    expect(eventMessage({ kind: 'evidence', ts: 't', code: 'x', verdict: 'fail' })).toBe('x: fail');
  });

  it('summarizes a sealed and a broken attestation', () => {
    expect(
      eventMessage({
        kind: 'attestation',
        ts: 't',
        code: 'receipt',
        verdict: 'PASSED',
        sealed: true,
        signing_mode: 'hash-chained',
      }),
    ).toBe('receipt PASSED (sealed, hash-chained)');
    expect(
      eventMessage({
        kind: 'attestation',
        ts: 't',
        code: 'receipt',
        verdict: 'FAILED',
        sealed: false,
      }),
    ).toBe('receipt FAILED (BROKEN-chain, unsigned)');
  });
});
