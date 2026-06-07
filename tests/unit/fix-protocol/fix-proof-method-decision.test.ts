import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDecisionPacket, validateDecisionPacket } from '@/planning/decision-packet.js';
import { decisionQuestionForCategory } from '@/planning/decision-packet-builder.js';
import { defaultSimilarityFor } from '@/planning/decision-evidence.js';
import { DecisionStore, readDecisionAuditEvents } from '@/planning/index.js';
import { buildFixProofMethodPacket } from '@/fix-protocol/fix-proof-method-decision.js';

const BASE = {
  defect_id: 'DEF-1',
  kind: 'visual-appearance',
  task_session_id: 'sess-1',
  created_at: '2026-06-07T00:00:00Z',
};

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
    expect(packet.ttl_until).toBe('2026-07-07T00:00:00.000Z');
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
    const first = buildFixProofMethodPacket({ ...BASE, decision_id: 'D-1', detail: 'defect one' });
    store.writePending(first);
    store.resolve({
      decisionId: 'D-1',
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
    expect(reusedId).toBe('D-1');

    const reuseEvents = readDecisionAuditEvents(projectRoot).filter(
      (event) => event.event === 'decision-reused',
    );
    expect(reuseEvents).toHaveLength(1);
  });
});
