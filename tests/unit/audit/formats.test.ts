import { describe, expect, it } from 'vitest';

import { escapeCefExtension, escapeCefHeader, toCef } from '@/audit/formats/cef';
import { toEcs, toEcsRecord } from '@/audit/formats/ecs';
import { toOcsf, toOcsfRecord } from '@/audit/formats/ocsf';
import type { SiemEvent } from '@/audit/types';

const VER = '1.2.3';

const evidence: SiemEvent = {
  kind: 'evidence',
  ts: '2026-06-11T00:00:00.000Z',
  engine: 'verification-gate',
  code: 'mutation-testing',
  verdict: 'pass',
  subject_digest: 'subj-abc',
  strength_class: 'deterministic',
  content_hash: 'hash-1',
  detail: 'killed 9/10 mutants',
};

const attestation: SiemEvent = {
  kind: 'attestation',
  ts: '2026-06-11T01:00:00.000Z',
  code: 'receipt',
  verdict: 'PASSED',
  content_hash: 'rh-1',
  receipt_index: 0,
  receipt_hash: 'rh-1',
  prev_receipt_hash: '0'.repeat(64),
  signing_mode: 'hash-chained',
  sealed: true,
  subjects: [
    { name: 'src/a.ts', sha256: 'aaa' },
    { name: 'src/b.ts', sha256: 'bbb' },
  ],
  authorship: {
    agent: 'claude-code',
    model: 'claude-opus-4-8',
    provider: 'anthropic',
    model_id: 'anthropic/claude-opus-4-8',
    accepting_human: { name: 'Ada', email: 'ada@example.com' },
    provenance: 'declared',
  },
};

describe('OCSF formatter', () => {
  it('maps an evidence row to Application Activity with graded paqad extension', () => {
    const rec = toOcsfRecord(evidence, VER);
    expect(rec.class_uid).toBe(6003);
    expect(rec.category_uid).toBe(6);
    expect(rec.type_uid).toBe(600300);
    expect(rec.time).toBe(Date.parse(evidence.ts));
    expect(rec.severity_id).toBe(1); // pass → informational
    expect(rec.status_id).toBe(1);
    expect(rec.status).toBe('Success');
    const meta = rec.metadata as Record<string, unknown>;
    expect((meta.product as Record<string, unknown>).version).toBe(VER);
    expect(meta.uid).toBe('hash-1');
    const paqad = (rec.unmapped as Record<string, unknown>).paqad as Record<string, unknown>;
    expect(paqad.strength_class).toBe('deterministic');
    expect(paqad.engine).toBe('verification-gate');
    expect(rec.actor).toBeUndefined();
    expect(rec.observables).toBeUndefined();
  });

  it('maps an attestation with actor + observables + failure severity', () => {
    const rec = toOcsfRecord({ ...attestation, verdict: 'FAILED' }, VER);
    expect(rec.severity_id).toBe(4); // FAILED → high
    expect(rec.status_id).toBe(2);
    expect(rec.status).toBe('Failure');
    const actor = rec.actor as Record<string, unknown>;
    expect(actor.app_name).toBe('claude-code');
    expect((actor.user as Record<string, unknown>).email_addr).toBe('ada@example.com');
    const observables = rec.observables as Array<Record<string, unknown>>;
    expect(observables).toHaveLength(2);
    expect(observables[0]).toEqual({ name: 'src/a.ts', type: 'File Hash', value: 'aaa' });
  });

  it('omits actor.user when authorship carries no human, and uses Unknown status', () => {
    const rec = toOcsfRecord(
      {
        kind: 'attestation',
        ts: '',
        code: 'receipt',
        verdict: 'unknown',
        authorship: { agent: 'codex-cli', provenance: 'declared' },
      },
      VER,
    );
    expect(rec.time).toBe(0); // empty ts → epoch 0
    expect(rec.severity_id).toBe(0);
    expect(rec.status).toBe('Unknown');
    const actor = rec.actor as Record<string, unknown>;
    expect(actor.app_name).toBe('codex-cli');
    expect(actor.user).toBeUndefined();
  });

  it('carries a name-only human into actor.user', () => {
    const rec = toOcsfRecord(
      { ...attestation, authorship: { accepting_human: { name: 'Ada' }, provenance: 'declared' } },
      VER,
    );
    expect((rec.actor as Record<string, unknown>).user).toEqual({ name: 'Ada' });
  });

  it('carries an email-only human into actor.user', () => {
    const rec = toOcsfRecord(
      {
        ...attestation,
        authorship: { accepting_human: { email: 'a@b.c' }, provenance: 'declared' },
      },
      VER,
    );
    expect((rec.actor as Record<string, unknown>).user).toEqual({ email_addr: 'a@b.c' });
  });

  it('serializes to a single JSON line', () => {
    expect(toOcsf(evidence, VER)).not.toContain('\n');
    expect(JSON.parse(toOcsf(evidence, VER)).class_uid).toBe(6003);
  });
});

describe('ECS formatter', () => {
  it('maps an evidence row with outcome + labels + event.id', () => {
    const rec = toEcsRecord(evidence, VER);
    expect(rec['@timestamp']).toBe(evidence.ts);
    const event = rec.event as Record<string, unknown>;
    expect(event.action).toBe('mutation-testing');
    expect(event.outcome).toBe('success');
    expect(event.id).toBe('hash-1');
    expect(event.reason).toBe('killed 9/10 mutants');
    const labels = rec.labels as Record<string, string>;
    expect(labels.paqad_strength_class).toBe('deterministic');
    expect(rec.file).toBeUndefined();
    expect(rec.user).toBeUndefined();
  });

  it('maps a single-subject attestation to file.hash.sha256', () => {
    const single: SiemEvent = { ...attestation, subjects: [{ name: 'src/a.ts', sha256: 'aaa' }] };
    const rec = toEcsRecord(single, VER);
    expect((rec.file as Record<string, unknown>).name).toBe('src/a.ts');
    expect(((rec.file as Record<string, unknown>).hash as Record<string, unknown>).sha256).toBe(
      'aaa',
    );
    expect((rec.related as Record<string, unknown>).hash).toEqual(['aaa']);
    const user = rec.user as Record<string, unknown>;
    expect(user.email).toBe('ada@example.com');
  });

  it('keeps multi-subject digests in related.hash only, outcome failure/unknown', () => {
    const rec = toEcsRecord(attestation, VER);
    expect(rec.file).toBeUndefined();
    expect((rec.related as Record<string, unknown>).hash).toEqual(['aaa', 'bbb']);
    expect(
      (toEcsRecord({ ...evidence, verdict: 'fail' }, VER).event as Record<string, unknown>).outcome,
    ).toBe('failure');
    expect(
      (toEcsRecord({ ...evidence, verdict: 'blocked' }, VER).event as Record<string, unknown>)
        .outcome,
    ).toBe('unknown');
  });

  it('maps a name-only human and an evidence row with no subjects/user', () => {
    const single: SiemEvent = {
      ...attestation,
      subjects: [{ name: 'src/a.ts', sha256: 'aaa' }],
      authorship: { accepting_human: { name: 'Ada' }, provenance: 'declared' },
    };
    expect(toEcsRecord(single, VER).user as Record<string, unknown>).toEqual({ name: 'Ada' });
    // an evidence event without receipt_hash omits that label
    const rec = toEcsRecord(evidence, VER);
    expect((rec.labels as Record<string, string>).paqad_receipt_hash).toBeUndefined();
    expect(rec.related).toBeUndefined();
  });

  it('omits event.id when there is no content_hash and user when the human is empty', () => {
    const noHash: SiemEvent = {
      kind: 'evidence',
      ts: '2026-06-11T00:00:00.000Z',
      code: 'x',
      verdict: 'pass',
      authorship: { accepting_human: {}, provenance: 'unknown' },
    };
    const rec = toEcsRecord(noHash, VER);
    expect((rec.event as Record<string, unknown>).id).toBeUndefined();
    expect(rec.user).toBeUndefined(); // empty human → no user block
  });

  it('maps an email-only human', () => {
    const rec = toEcsRecord(
      {
        ...attestation,
        authorship: { accepting_human: { email: 'a@b.c' }, provenance: 'declared' },
      },
      VER,
    );
    expect(rec.user).toEqual({ email: 'a@b.c' });
  });

  it('serializes to a single JSON line', () => {
    expect(toEcs(evidence, VER)).not.toContain('\n');
  });
});

describe('CEF formatter', () => {
  it('escapes header and extension special characters', () => {
    expect(escapeCefHeader('a|b\\c')).toBe('a\\|b\\\\c');
    expect(escapeCefExtension('k=v\\x\nline')).toBe('k\\=v\\\\x line');
  });

  it('renders an evidence row as a single CEF line', () => {
    const line = toCef(evidence, VER);
    expect(line.startsWith('CEF:0|Paqad|paqad-ai|1.2.3|mutation-testing|')).toBe(true);
    expect(line).toContain('|2|'); // pass → severity 2
    expect(line).toContain('cs1=subj-abc');
    expect(line).toContain('cs2=deterministic');
    expect(line).toContain('msg=killed 9/10 mutants');
    expect(line).not.toContain('\n');
  });

  it('renders an attestation with file + multi-file count + suser', () => {
    const line = toCef(attestation, VER);
    expect(line).toContain('|2|'); // PASSED → severity 2
    expect(line).toContain('fileHash=aaa');
    expect(line).toContain('fname=src/a.ts');
    expect(line).toContain('cn1=2');
    expect(line).toContain('suser=ada@example.com');
    expect(line).toContain('cs5=hash-chained');
    expect(line).toContain('cs6=true');
  });

  it('omits empty extension fields and falls back to human name for suser', () => {
    const sparse: SiemEvent = {
      kind: 'attestation',
      ts: 'not-a-date',
      code: 'receipt',
      verdict: 'inconclusive',
      authorship: { accepting_human: { name: 'Grace' }, provenance: 'unknown' },
    };
    const line = toCef(sparse, VER);
    expect(line).toContain('rt=0'); // unparseable ts → 0
    expect(line).toContain('|5|'); // inconclusive → severity 5
    expect(line).toContain('suser=Grace');
    expect(line).not.toContain('cs1=');
    expect(line).not.toContain('fileHash=');
  });
});

// Buildout F6 — a #249 session-ledger fold event must render in every format with
// its doc type + session id surfaced, not silently dropped.
const session: SiemEvent = {
  kind: 'session',
  ts: '2026-06-20T00:00:00.000Z',
  code: 'decision-evidence',
  doc_type: 'decision-evidence',
  session_id: '_project',
  verdict: 'opened',
  content_hash: 'dhash-1',
  detail: 'opened D-1',
};

describe('session-ledger fold across formatters', () => {
  it('OCSF maps a session event to a Session activity with doc_type + session_id', () => {
    const rec = toOcsfRecord(session, VER);
    expect(rec.activity_name).toBe('Session');
    expect(rec.severity_id).toBe(0); // lifecycle event → informational/unknown
    const paqad = (rec.unmapped as Record<string, unknown>).paqad as Record<string, unknown>;
    expect(paqad.doc_type).toBe('decision-evidence');
    expect(paqad.session_id).toBe('_project');
    expect(paqad.detail).toBe('opened D-1');
    expect(rec.message).toBe('decision-evidence: opened D-1');
  });

  it('ECS carries doc_type + session_id as labels and detail as reason', () => {
    const rec = toEcsRecord(session, VER);
    const labels = rec.labels as Record<string, string>;
    expect(labels.paqad_kind).toBe('session');
    expect(labels.paqad_doc_type).toBe('decision-evidence');
    expect(labels.paqad_session_id).toBe('_project');
    expect((rec.event as Record<string, unknown>).reason).toBe('opened D-1');
    expect(rec.tags).toEqual(['paqad', 'session']);
  });

  it('CEF carries doc_type as sourceServiceName and session id as externalId', () => {
    const line = toCef(session, VER);
    expect(line).toContain('sourceServiceName=decision-evidence');
    expect(line).toContain('externalId=_project');
    expect(line).toContain('msg=opened D-1');
    expect(line).toContain('|session decision-evidence opened|'); // header name
  });

  it('falls back to verdict + code in the message when a session event lacks detail/doc_type', () => {
    const sparse: SiemEvent = { ...session, detail: undefined, doc_type: undefined };
    // source falls back from doc_type to code; no detail → verdict tail.
    expect(toOcsfRecord(sparse, VER).message).toBe('decision-evidence: opened');
    expect((toEcsRecord(sparse, VER).event as Record<string, unknown>).reason).toBeUndefined();
  });
});
