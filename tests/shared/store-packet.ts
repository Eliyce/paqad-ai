import type { DecisionOption, DecisionPacket } from '@/planning/decision-packet.js';

export function storeOptions(keys: readonly string[]): DecisionOption[] {
  return keys.map((key) => ({
    option_key: key,
    label: `Use option ${key}`,
    one_line_preview: `If you pick this, we use ${key}.`,
    trade_off: 'You give up: the other.',
    evidence: {},
  }));
}

export function pendingStorePacket(overrides: Partial<DecisionPacket> = {}): DecisionPacket {
  return {
    decision_id: 'D-01J0000000000000000000ZZZZ',
    fingerprint: 'sha256:store',
    category: 'component-reuse',
    question: 'Which shape should this take',
    context: 'Store shape',
    options: storeOptions(['a', 'b']),
    confidence: 1,
    requested_by: 'test',
    task_session_id: 'store-task',
    created_at: '2026-06-01T00:00:00.000Z',
    status: 'pending',
    ttl_until: '2999-01-01T00:00:00.000Z',
    invalidation_watch: [],
    ...overrides,
  };
}
