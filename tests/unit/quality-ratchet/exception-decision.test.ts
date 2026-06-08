import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateDecisionPacket, type DecisionHumanResponse } from '@/planning/decision-packet.js';
import { DecisionStore } from '@/planning/decision-store.js';
import {
  RATCHET_EXCEPTION_APPROVE,
  RATCHET_EXCEPTION_REFUSE,
  buildRatchetExceptionPacket,
  resolveReusableExceptionKinds,
  type RatchetExceptionInput,
} from '@/quality-ratchet/exception-decision.js';

const NOW = '2026-06-08T00:00:00.000Z';

function input(overrides: Partial<RatchetExceptionInput> = {}): RatchetExceptionInput {
  return {
    decision_id: 'D-1',
    kind: 'quality.strictness',
    measure: 'strictness',
    module: '(project)',
    baseline_value: 2,
    current_value: 5,
    task_session_id: 'task-1',
    created_at: NOW,
    ...overrides,
  };
}

function approval(): DecisionHumanResponse {
  return {
    chosen_option_key: RATCHET_EXCEPTION_APPROVE,
    intent: 'explicit',
    explanation_rounds_used: 0,
    responded_at: NOW,
    responded_by: 'human',
    carry_over_scope: 'task',
  };
}

describe('quality.ratchet_exception decision', () => {
  it('builds a valid Decision Packet that defaults to holding the line', () => {
    const packet = buildRatchetExceptionPacket(input());
    expect(validateDecisionPacket(packet)).toEqual([]);
    expect(packet.category).toBe('quality.ratchet_exception');
    expect(packet.recommendation).toBe(RATCHET_EXCEPTION_REFUSE);
    expect(packet.options.map((o) => o.option_key)).toEqual([
      RATCHET_EXCEPTION_APPROVE,
      RATCHET_EXCEPTION_REFUSE,
    ]);
  });

  it('fingerprints by kind so same-kind regressions match regardless of the numbers', () => {
    const a = buildRatchetExceptionPacket(input({ current_value: 5 }));
    const b = buildRatchetExceptionPacket(
      input({ current_value: 99, module: 'core', decision_id: 'D-7' }),
    );
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('reuses an earlier approval by kind (decision-reused, no re-ask)', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ratchet-dpc-'));
    const store = new DecisionStore(root);
    store.initialize();
    store.resolveExisting({
      packet: buildRatchetExceptionPacket(input()),
      humanResponse: approval(),
      event: 'decision-resolved-by-human',
    });

    // A later, same-kind regression with different numbers reuses the approval.
    const approved = resolveReusableExceptionKinds(store, ['quality.strictness'], (kind) =>
      buildRatchetExceptionPacket(input({ kind, decision_id: 'D-9', current_value: 42 })),
    );
    expect(approved.has('quality.strictness')).toBe(true);

    const audit = readFileSync(join(root, '.paqad/decisions/audit.jsonl'), 'utf8');
    expect(audit).toContain('decision-reused');
  });

  it('does not reuse a kind that was resolved as "hold the line"', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ratchet-dpc-hold-'));
    const store = new DecisionStore(root);
    store.initialize();
    store.resolveExisting({
      packet: buildRatchetExceptionPacket(input()),
      humanResponse: { ...approval(), chosen_option_key: RATCHET_EXCEPTION_REFUSE },
      event: 'decision-resolved-by-human',
    });

    const approved = resolveReusableExceptionKinds(store, ['quality.strictness'], (kind) =>
      buildRatchetExceptionPacket(input({ kind })),
    );
    expect(approved.size).toBe(0);
  });

  it('returns an empty set when there is no prior decision', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ratchet-dpc-none-'));
    const store = new DecisionStore(root);
    store.initialize();
    const approved = resolveReusableExceptionKinds(store, ['quality.dead_code'], (kind) =>
      buildRatchetExceptionPacket(input({ kind, measure: 'dead_code' })),
    );
    expect(approved.size).toBe(0);
  });
});
