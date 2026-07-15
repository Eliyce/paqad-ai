import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isDecisionPacket, validateDecisionPacket } from '@/planning/decision-packet.js';
import { decisionQuestionForCategory } from '@/planning/decision-packet-builder.js';
import { defaultSimilarityFor } from '@/planning/decision-evidence.js';
import { DecisionStore, readDecisionAuditEvents } from '@/planning/index.js';
import { buildFlakyJudgementPacket } from '@/flaky/flaky-judgement-decision.js';

const BASE = {
  test_id: 'suite > sometimes times out',
  kind: 'rare-timeout',
  task_session_id: 'sess-1',
  created_at: '2026-06-08T00:00:00Z',
};

// Issue #387 — a packet written through DecisionStore.writePending must carry a strict
// `D-<ULID>` id. The builder unit tests above keep using legacy `D-1`/`D-2` ids on
// purpose (they only validate, never write, proving read tolerance stays intact).
const WRITTEN_ID = 'D-01J000000000000000000000A1';

describe('buildFlakyJudgementPacket', () => {
  it('produces a valid test.flaky_judgement packet with stable option keys', () => {
    const packet = buildFlakyJudgementPacket({
      ...BASE,
      decision_id: 'D-1',
      detail: 'Failed 1 of 5 re-runs; suspected timing.',
    });
    expect(validateDecisionPacket(packet)).toEqual([]);
    expect(isDecisionPacket(packet)).toBe(true);
    expect(packet.category).toBe('test.flaky_judgement');
    expect(packet.options.map((o) => o.option_key)).toEqual([
      'quarantine-as-flaky',
      'keep-as-real-fault',
      'gather-more-reruns',
    ]);
    // ttl_days for test.flaky_judgement is 30.
    expect(packet.ttl_until).toBe('2026-07-08T00:00:00.000Z');
  });

  it('fingerprints by kind so the same kind shares a fingerprint regardless of detail', () => {
    const a = buildFlakyJudgementPacket({ ...BASE, decision_id: 'D-1', detail: 'first' });
    const b = buildFlakyJudgementPacket({
      ...BASE,
      decision_id: 'D-2',
      test_id: 'other > test',
      detail: 'second, same kind',
    });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('exposes the category in the generic builder switches (typecheck guards)', () => {
    expect(decisionQuestionForCategory('test.flaky_judgement')).toContain('flaky');
    expect(defaultSimilarityFor('test.flaky_judgement', true, 0)).toBe(0.5);
  });
});

describe('test.flaky_judgement reuse by kind', () => {
  let projectRoot: string;

  beforeEach(() => {
    // Freeze the clock inside the packet's 30-day TTL window (created_at 2026-06-08)
    // so reuse is deterministic regardless of the real date — otherwise the fixture
    // rots the day its TTL lapses. Only Date is faked, so fs/timers are untouched.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-flaky-judge-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reuses a same-kind resolution via fuzzy match and emits decision-reused', () => {
    const store = new DecisionStore(projectRoot);
    store.initialize();

    const first = buildFlakyJudgementPacket({
      ...BASE,
      decision_id: WRITTEN_ID,
      detail: 'case one',
    });
    store.writePending(first);
    store.resolve({
      decisionId: WRITTEN_ID,
      humanResponse: {
        chosen_option_key: 'quarantine-as-flaky',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-06-08T01:00:00Z',
        responded_by: 'human',
        carry_over_scope: 'task',
      },
    });

    const second = buildFlakyJudgementPacket({
      ...BASE,
      decision_id: 'D-2',
      test_id: 'another > test',
      detail: 'case two, same kind',
    });
    expect(store.findReusableDecision(second)).toBe(WRITTEN_ID);

    const reuseEvents = readDecisionAuditEvents(projectRoot).filter(
      (event) => event.event === 'decision-reused',
    );
    expect(reuseEvents).toHaveLength(1);
  });
});
