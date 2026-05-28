import { describe, expect, it } from 'vitest';

import type { DecisionRecord } from '@/core/types/planning.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { DecisionSessionState } from '@/planning/decision-session.js';

describe('decision session state', () => {
  it('applies a task carry-over only within the same task and overlapping option set', () => {
    const state = new DecisionSessionState();
    const packet = createPacket({ carry_over_scope: 'task', task_session_id: 'task-a' });
    const record = createRecord('D-2');

    state.addCarryOver(packet, record);

    expect(state.findCarryOver(createPacket(), 'task-a')?.record.decision_id).toBe('D-2');
    expect(state.findCarryOver(createPacket(), 'task-b')).toBeNull();
    expect(
      state.findCarryOver(
        createPacket({
          options: [createOption('choose-other', 'Choose other path'), createOption('make-new')],
        }),
        'task-a',
      ),
    ).toBeNull();
  });

  it('applies a session carry-over across tasks in the same process', () => {
    const state = new DecisionSessionState();
    state.addCarryOver(
      createPacket({ carry_over_scope: 'session', task_session_id: 'task-a' }),
      createRecord('D-3'),
    );

    expect(state.findCarryOver(createPacket(), 'task-b')?.record.decision_id).toBe('D-3');
  });

  it('ignores non-carry-over responses and tracks per-task screen caps', () => {
    const state = new DecisionSessionState();
    state.addCarryOver(createPacket({ carry_over_scope: 'none' }), createRecord('D-4'));

    expect(state.findCarryOver(createPacket(), 'task-a')).toBeNull();
    expect(state.hasReachedScreenCap('task-a')).toBe(false);
    expect(state.recordScreenShown('task-a')).toBe(1);
    expect(state.recordScreenShown('task-a')).toBe(2);
    expect(state.recordScreenShown('task-a')).toBe(3);
    expect(state.hasReachedScreenCap('task-a')).toBe(true);
    expect(state.hasReachedScreenCap('task-b', 1)).toBe(false);
  });

  it('replaces matching carry-overs and skips category or option mismatches', () => {
    const state = new DecisionSessionState();
    state.addCarryOver(
      createPacket({ decision_id: 'D-5', carry_over_scope: 'session' }),
      createRecord('D-5'),
    );
    state.addCarryOver(
      createPacket({ decision_id: 'D-6', carry_over_scope: 'session' }),
      createRecord('D-6'),
    );

    expect(state.findCarryOver(createPacket(), 'task-z')?.source_decision_id).toBe('D-6');
    expect(
      state.findCarryOver(
        createPacket({
          category: 'ux-pattern',
          options: [createOption('reuse-existing'), createOption('make-new')],
        }),
        'task-z',
      ),
    ).toBeNull();
    expect(
      state.findCarryOver(
        createPacket({
          options: [createOption('choose-other'), createOption('pick-another')],
        }),
        'task-z',
      ),
    ).toBeNull();
    expect(
      state.findCarryOver(
        createPacket({
          options: [createOption('make-new'), createOption('pick-another')],
        }),
        'task-z',
      ),
    ).toBeNull();
  });
});

function createPacket(
  overrides: Partial<DecisionPacket> & {
    carry_over_scope?: DecisionPacket['human_response'] extends infer T
      ? T extends { carry_over_scope: infer Scope }
        ? Scope
        : never
      : never;
  } = {},
): DecisionPacket {
  const carryOverScope = overrides.carry_over_scope ?? 'task';
  return {
    decision_id: overrides.decision_id ?? 'D-2',
    fingerprint: overrides.fingerprint ?? 'sha256:test',
    category: overrides.category ?? 'create-vs-reuse',
    question: overrides.question ?? 'Reuse this or make new?',
    context: overrides.context ?? 'A shared UI path needs a decision.',
    options: overrides.options ?? [createOption('reuse-existing'), createOption('make-new')],
    confidence: overrides.confidence ?? 0.3,
    requested_by: overrides.requested_by ?? 'codex-cli',
    task_session_id: overrides.task_session_id ?? 'task-a',
    created_at: overrides.created_at ?? '2026-04-27T12:00:00Z',
    status: overrides.status ?? 'resolved',
    human_response: overrides.human_response ?? {
      chosen_option_key: 'reuse-existing',
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: '2026-04-27T12:01:00Z',
      responded_by: 'haider',
      carry_over_scope: carryOverScope,
    },
    ttl_until: overrides.ttl_until ?? '2099-12-31T12:00:00Z',
    invalidation_watch: overrides.invalidation_watch ?? ['src/example.ts'],
  };
}

function createOption(option_key: string, label = 'Reuse what exists') {
  return {
    option_key,
    label,
    one_line_preview: `If you pick this, we will update src/${option_key}.ts.`,
    trade_off: 'You give up: a different path.',
    evidence: { file: `src/${option_key}.ts`, callers: 1, evidence_partial: true },
  };
}

function createRecord(decisionId: string): DecisionRecord {
  return {
    decision_id: decisionId,
    choice: 'Reuse what exists',
    reason: 'You give up: a different path.',
    alternatives_rejected: [
      {
        alternative: 'Make a new one',
        rejection_reason: 'You give up: the existing shared path.',
      },
    ],
    linked_requirements: ['FR-1'],
    reversibility: 'easy',
  };
}
