import { describe, expect, it } from 'vitest';

import { REDACTED, redactEvent } from '@/audit/redact';
import type { SiemEvent } from '@/audit/types';

describe('redactEvent', () => {
  it('replaces free-text detail and preserves non-PII provenance', () => {
    const event: SiemEvent = {
      kind: 'evidence',
      ts: '2026-06-11T00:00:00.000Z',
      code: 'mutation-testing',
      verdict: 'pass',
      subject_digest: 'subj',
      content_hash: 'hash',
      detail: 'failing in src/secret.ts: token=abc',
    };
    const out = redactEvent(event);
    expect(out.detail).toBe(REDACTED);
    expect(out.subject_digest).toBe('subj');
    expect(out.content_hash).toBe('hash');
    // original is untouched
    expect(event.detail).toContain('secret');
  });

  it('redacts both name and email of the accepting human', () => {
    const out = redactEvent({
      kind: 'attestation',
      ts: 't',
      code: 'receipt',
      verdict: 'PASSED',
      authorship: {
        agent: 'claude-code',
        accepting_human: { name: 'Ada', email: 'ada@example.com' },
        provenance: 'declared',
      },
    });
    expect(out.authorship?.accepting_human).toEqual({ name: REDACTED, email: REDACTED });
    expect(out.authorship?.agent).toBe('claude-code'); // agent is not PII
  });

  it('redacts only the fields the human actually carries', () => {
    const nameOnly = redactEvent({
      kind: 'attestation',
      ts: 't',
      code: 'receipt',
      verdict: 'PASSED',
      authorship: { accepting_human: { name: 'Grace' }, provenance: 'declared' },
    });
    expect(nameOnly.authorship?.accepting_human).toEqual({ name: REDACTED });

    const emailOnly = redactEvent({
      kind: 'attestation',
      ts: 't',
      code: 'receipt',
      verdict: 'PASSED',
      authorship: { accepting_human: { email: 'a@b.c' }, provenance: 'declared' },
    });
    expect(emailOnly.authorship?.accepting_human).toEqual({ email: REDACTED });
  });

  it('is a no-op when there is no detail and no authorship', () => {
    const event: SiemEvent = { kind: 'evidence', ts: 't', code: 'c', verdict: 'pass' };
    expect(redactEvent(event)).toEqual(event);
  });

  it('leaves authorship without a human untouched', () => {
    const out = redactEvent({
      kind: 'attestation',
      ts: 't',
      code: 'receipt',
      verdict: 'PASSED',
      authorship: { agent: 'cursor', provenance: 'unknown' },
    });
    expect(out.authorship).toEqual({ agent: 'cursor', provenance: 'unknown' });
  });
});
