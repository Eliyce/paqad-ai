import { describe, expect, it } from 'vitest';

import {
  PriorityClassifier,
  InferredTurnClassifierModel,
  type TurnClassifierModel,
} from '@/context/priority-classifier.js';
import type { TurnInput, TurnPriority } from '@/core/types/context.js';

/**
 * Inline stub: returns a caller-controlled tag per turn_id, defaulting to
 * `normal` for any unmapped turn. Lets each test pin exactly what the "model"
 * says before the engine applies its invariants.
 */
function stubModel(scores: Record<string, TurnPriority>): TurnClassifierModel {
  return {
    score: (turn: TurnInput) => scores[turn.turn_id] ?? 'normal',
  };
}

function turn(overrides: Partial<TurnInput> & { turn_id: string }): TurnInput {
  return { text: 'hello', ...overrides };
}

describe('PriorityClassifier.tag', () => {
  it('tags every turn and defaults unsignalled turns to normal', () => {
    const classifier = new PriorityClassifier();
    const turns = [turn({ turn_id: 'a' }), turn({ turn_id: 'b' }), turn({ turn_id: 'c' })];

    const result = classifier.tag(turns);

    expect(result.tagged).toHaveLength(3);
    expect(result.tagged.map((t) => t.priority)).toEqual(['normal', 'normal', 'normal']);
    expect(result.warnings).toEqual([]);
  });

  it('tags decision_packet and approval_turn turns high regardless of the model', () => {
    const classifier = new PriorityClassifier(stubModel({ dp: 'low', appr: 'normal' }));

    const result = classifier.tag([
      turn({ turn_id: 'dp', decision_packet: true }),
      turn({ turn_id: 'appr', approval_turn: true }),
    ]);

    expect(result.tagged.find((t) => t.turn_id === 'dp')?.priority).toBe('high');
    expect(result.tagged.find((t) => t.turn_id === 'appr')?.priority).toBe('high');
  });

  it('does not overwrite a protected turn already tagged high on a re-tag pass', () => {
    // A model that would lower the turn — the re-tag guard must keep it high
    // without raising a breach warning.
    const classifier = new PriorityClassifier(stubModel({ dp: 'low' }));

    const first = classifier.tag([turn({ turn_id: 'dp', decision_packet: true })]);
    expect(first.tagged[0].priority).toBe('high');

    // Feed the tagged turns back in.
    const second = classifier.tag(first.tagged);

    expect(second.tagged[0].priority).toBe('high');
    expect(second.warnings).toEqual([]);
  });

  it('corrects a protected turn the model scored low and emits a health warning', () => {
    const classifier = new PriorityClassifier(stubModel({ dp: 'low' }));

    const result = classifier.tag([turn({ turn_id: 'dp', decision_packet: true })]);

    expect(result.tagged[0].priority).toBe('high');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toEqual({
      type: 'context.context_health_warning',
      reason: 'priority_invariant_breach',
      turn_id: 'dp',
      classifier_returned: 'low',
      corrected_to: 'high',
    });
  });

  it('flattens ordinary turns to normal under all_normal but keeps protected turns high', () => {
    // Model would score the ordinary turn high; all_normal must override it to
    // normal, while the protected turn stays high.
    const classifier = new PriorityClassifier(stubModel({ ord: 'high', dp: 'normal' }));

    const result = classifier.tag(
      [turn({ turn_id: 'ord' }), turn({ turn_id: 'dp', decision_packet: true })],
      { all_normal: true },
    );

    expect(result.tagged.find((t) => t.turn_id === 'ord')?.priority).toBe('normal');
    expect(result.tagged.find((t) => t.turn_id === 'dp')?.priority).toBe('high');
    // The protected turn was corrected normal -> high, so one breach is expected.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].turn_id).toBe('dp');
  });

  it('returns an empty result for an empty input without error', () => {
    const classifier = new PriorityClassifier();

    expect(classifier.tag([])).toEqual({ tagged: [], warnings: [] });
  });

  it('emits no warning when the model already returns high for a protected turn', () => {
    const classifier = new PriorityClassifier(stubModel({ dp: 'high' }));

    const result = classifier.tag([turn({ turn_id: 'dp', decision_packet: true })]);

    expect(result.tagged[0].priority).toBe('high');
    expect(result.warnings).toEqual([]);
  });

  it('tags 49 turns synchronously in under 20 ms', () => {
    const classifier = new PriorityClassifier();
    const turns = Array.from({ length: 49 }, (_, i) => turn({ turn_id: `t${i}` }));

    const start = performance.now();
    const result = classifier.tag(turns);
    const elapsed = performance.now() - start;

    expect(result.tagged).toHaveLength(49);
    expect(elapsed).toBeLessThan(20);
  });

  it('defaults to the inferred model which scores ordinary turns normal', () => {
    const model = new InferredTurnClassifierModel();

    expect(model.score()).toBe('normal');
  });
});
