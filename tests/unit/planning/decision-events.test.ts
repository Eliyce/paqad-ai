import {
  DECISION_PAUSE_EVENT_TYPES,
  decisionCapExceededEvent,
  decisionDiscardedEvent,
  decisionPacketCorruptEvent,
  decisionPausedEvent,
  decisionResolvedEvent,
  type DecisionPacket,
} from '@/planning/index.js';

function makePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: 'D-7',
    fingerprint: 'sha256:test',
    category: 'component-reuse',
    question: 'Use the Button we have?',
    context: 'Adding a dashboard action.',
    options: [
      {
        option_key: 'reuse-button',
        label: 'Reuse Button',
        one_line_preview: 'We will update src/components/Button.tsx.',
        trade_off: 'You give up: a fresh design.',
        evidence: { file: 'src/components/Button.tsx', callers: 3 },
        technical_detail: 'Re-exports the existing component.',
      },
    ],
    recommendation: 'reuse-button',
    recommendation_reason: 'It already has 3 callers.',
    confidence: 0.72,
    requested_by: 'codex-cli',
    task_session_id: 'session-1',
    linked_slice_id: 'SL-2',
    created_at: '2026-04-27T12:00:00Z',
    status: 'pending',
    ttl_until: '2099-12-31T12:00:00Z',
    invalidation_watch: [],
    ...overrides,
  };
}

describe('decision-pause event builders (PQD-101)', () => {
  it('lists exactly the five decision-pause discriminants', () => {
    expect([...DECISION_PAUSE_EVENT_TYPES]).toEqual([
      'decision-paused',
      'decision-resolved',
      'decision-packet-corrupt',
      'decision-cap-exceeded',
      'decision-discarded',
    ]);
  });

  it('builds a decision-paused event carrying the full packet content', () => {
    const event = decisionPausedEvent(makePacket(), '.paqad/decisions/pending/D-7.json');
    expect(event).toMatchObject({
      kind: 'decision-paused',
      decisionId: 'D-7',
      category: 'component-reuse',
      question: 'Use the Button we have?',
      recommendation: 'reuse-button',
      recommendationReason: 'It already has 3 callers.',
      packetPath: '.paqad/decisions/pending/D-7.json',
      linkedSliceId: 'SL-2',
    });
    expect(event.options).toEqual([
      {
        option_key: 'reuse-button',
        label: 'Reuse Button',
        one_line_preview: 'We will update src/components/Button.tsx.',
        trade_off: 'You give up: a fresh design.',
        technical_detail: 'Re-exports the existing component.',
      },
    ]);
    expect(typeof event.at).toBe('string');
  });

  it('defaults recommendation to null and omits absent optional fields', () => {
    const event = decisionPausedEvent(
      makePacket({
        recommendation: undefined,
        recommendation_reason: undefined,
        linked_slice_id: undefined,
      }),
      '.paqad/decisions/pending/D-7.json',
    );
    expect(event.recommendation).toBeNull();
    expect('recommendationReason' in event).toBe(false);
    expect('linkedSliceId' in event).toBe(false);
  });

  it('builds a decision-resolved event from a resolved packet', () => {
    const resolved = makePacket({
      status: 'resolved',
      human_response: {
        chosen_option_key: 'reuse-button',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: '2026-04-27T12:01:00Z',
        responded_by: 'haider',
        carry_over_scope: 'none',
      },
    });
    expect(decisionResolvedEvent(resolved, 'human')).toMatchObject({
      kind: 'decision-resolved',
      decisionId: 'D-7',
      chosenOptionKey: 'reuse-button',
      resolver: 'human',
      intent: 'explicit',
    });
  });

  it('builds corrupt, cap-exceeded, and discarded events', () => {
    expect(decisionPacketCorruptEvent('D-7', 'invalid JSON')).toMatchObject({
      kind: 'decision-packet-corrupt',
      decisionId: 'D-7',
      reason: 'invalid JSON',
    });
    expect(decisionCapExceededEvent(20, 20)).toMatchObject({
      kind: 'decision-cap-exceeded',
      pendingCount: 20,
      cap: 20,
    });
    expect(decisionDiscardedEvent('D-7', 'stale')).toMatchObject({
      kind: 'decision-discarded',
      decisionId: 'D-7',
      reason: 'stale',
    });
  });
});
