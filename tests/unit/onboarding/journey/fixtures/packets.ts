import type { DecisionPacket } from '../../../../../src/planning/decision-packet.js';

export const PACKET_ID = 'D-01J000000000000000000000C1';
export const PACKET_ID_2 = 'D-01J000000000000000000000C2';

export function journeyPacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: PACKET_ID,
    fingerprint: 'sha256:journey',
    category: 'component-reuse',
    question: 'Keep the existing rule or take the new one?',
    context: 'The analyzer found two rules that disagree.',
    options: [
      {
        option_key: 'keep-existing',
        label: 'Keep the existing rule',
        one_line_preview: 'If you pick this, the existing rule stays.',
        trade_off: 'You give up: the newer wording.',
        evidence: {},
      },
      {
        option_key: 'take-new',
        label: 'Take the new rule',
        one_line_preview: 'If you pick this, the new rule replaces it.',
        trade_off: 'You give up: the wording the team wrote.',
        evidence: {},
      },
    ],
    confidence: 0.6,
    recommendation: 'keep-existing',
    recommendation_reason: 'Keeping the existing rule changes nothing the team relies on.',
    requested_by: 'rule-analyzer',
    task_session_id: 'session-1',
    created_at: '2026-01-01T10:05:00.000Z',
    status: 'pending',
    ttl_until: '2099-12-31T12:00:00Z',
    invalidation_watch: [],
    ...overrides,
  };
}
