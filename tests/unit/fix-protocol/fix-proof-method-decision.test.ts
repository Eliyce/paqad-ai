import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDecisionPacket, validateDecisionPacket } from '@/planning/decision-packet.js';
import { decisionQuestionForCategory } from '@/planning/decision-packet-builder.js';
import { defaultSimilarityFor } from '@/planning/decision-evidence.js';
import { DecisionStore, readDecisionAuditEvents } from '@/planning/index.js';
import { buildFixProofMethodPacket } from '@/fix-protocol/fix-proof-method-decision.js';

// created_at is relative to the wall clock: the reuse path checks the packet's
// ttl_until (created_at + 30d) against Date.now(), so a fixed date rots — the
// original 2026-06-07 fixture started failing the day its TTL lapsed.
const CREATED_AT = new Date(Date.now() - 24 * 60 * 60 * 1000);
const BASE = {
  defect_id: 'DEF-1',
  kind: 'visual-appearance',
  task_session_id: 'sess-1',
  created_at: CREATED_AT.toISOString(),
};

// Issue #387 — a packet written through DecisionStore.writePending must carry a strict
// `D-<ULID>` id. The builder unit tests keep legacy `D-1`/`D-2` ids (validate-only, never
// written) to prove read tolerance stays intact.
const WRITTEN_ID = 'D-01J000000000000000000000A1';

describe('buildFixProofMethodPacket', () => {
  it('produces a valid fix.proof_method packet with stable option keys', () => {
    const packet = buildFixProofMethodPacket({
      ...BASE,
      decision_id: 'D-1',
      detail: 'The chart legend overlaps the axis on narrow screens.',
    });
    expect(validateDecisionPacket(packet)).toEqual([]);
    expect(isDecisionPacket(packet)).toBe(true);
    expect(packet.category).toBe('fix.proof_method');
    expect(packet.options.map((option) => option.option_key)).toEqual([
      'human-verification-step',
      'recorded-baseline-snapshot',
      'measured-threshold',
    ]);
    // ttl_days for fix.proof_method is 30.
    expect(packet.ttl_until).toBe(
      new Date(CREATED_AT.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('fingerprints by kind so the same kind shares a fingerprint regardless of detail', () => {
    const a = buildFixProofMethodPacket({ ...BASE, decision_id: 'D-1', detail: 'first defect' });
    const b = buildFixProofMethodPacket({
      ...BASE,
      decision_id: 'D-2',
      defect_id: 'DEF-2',
      detail: 'a different defect, same kind',
    });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('exposes the category in the generic builder switches (typecheck guards)', () => {
    expect(decisionQuestionForCategory('fix.proof_method')).toContain('auto-checked');
    expect(defaultSimilarityFor('fix.proof_method', true, 0)).toBe(0.5);
  });
});

describe('fix.proof_method reuse by kind', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-fixproof-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reuses a same-kind resolution via fuzzy match and emits decision-reused', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    // Ask once for a "visual-appearance" defect and resolve it.
    const first = buildFixProofMethodPacket({
      ...BASE,
      decision_id: WRITTEN_ID,
      detail: 'defect one',
    });
    store.writePending(first);
    store.resolve({
      decisionId: WRITTEN_ID,
      humanResponse: {
        chosen_option_key: 'human-verification-step',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-06-07T01:00:00Z',
        responded_by: 'human',
        carry_over_scope: 'task',
      },
    });

    // A new same-kind defect (different detail) must reuse the prior answer.
    const second = buildFixProofMethodPacket({
      ...BASE,
      decision_id: 'D-2',
      defect_id: 'DEF-2',
      detail: 'defect two, same visual kind',
    });
    const reusedId = store.findReusableDecision(second);
    expect(reusedId).toBe(WRITTEN_ID);

    const reuseEvents = readDecisionAuditEvents(projectRoot).filter(
      (event) => event.event === 'decision-reused',
    );
    expect(reuseEvents).toHaveLength(1);
  });
});
