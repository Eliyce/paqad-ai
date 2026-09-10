import { describe, expect, it } from 'vitest';

import { collectExpertQuestions, mergeQuestionBatch } from '@/spec-pipeline/experts/questions.js';
import { MAX_EXPERT_QUESTIONS } from '@/spec-pipeline/experts/types.js';
import type { PipelineQuestion } from '@/spec-pipeline/types.js';

function q(text: string): PipelineQuestion {
  return { business_text: text, why_it_matters: 'w', options: ['a', 'b'], grounded_in: null };
}

describe('collectExpertQuestions', () => {
  it('orders chief gap questions, then chief questions, then experts in need order', () => {
    const need = {
      experts: [
        { role: 'db-expert' as const, reason: 'r' },
        { role: 'security-auditor' as const, reason: 'r' },
      ],
    };
    const notes = {
      notes: [
        { role: 'security-auditor' as const, findings: [], questions: [q('sec-q')] },
        { role: 'db-expert' as const, findings: [], questions: [q('db-q')] },
      ],
      tokens: {},
    };
    const synthesis = {
      verdict: 'needs-answers' as const,
      accepted: [],
      declined: [],
      conflicts: [],
      gaps: [{ area: 'a', why_it_matters: 'w', question: q('gap-q') }],
      questions: [q('chief-q')],
      tokens: 0,
    };
    expect(collectExpertQuestions(need, notes, synthesis).map((x) => x.business_text)).toEqual([
      'gap-q',
      'chief-q',
      'db-q',
      'sec-q',
    ]);
  });

  it('returns nothing when there is no synthesis and no notes', () => {
    expect(collectExpertQuestions(null, null, null)).toEqual([]);
  });
});

describe('mergeQuestionBatch', () => {
  it('bounds the enrichment to the question budget and de-duplicates', () => {
    const result = mergeQuestionBatch([q('e1'), q('e2'), q('e3')], [], 2);
    expect(result.questions.map((x) => x.business_text)).toEqual(['e1', 'e2']);
    expect(result.deferred_from_experts).toEqual([]);
  });

  it('caps expert/chief questions at MAX_EXPERT_QUESTIONS and defers the overflow', () => {
    const expertChief = Array.from({ length: MAX_EXPERT_QUESTIONS + 2 }, (_, i) => q(`x${i}`));
    const result = mergeQuestionBatch([], expertChief, 0);
    expect(result.questions).toHaveLength(MAX_EXPERT_QUESTIONS);
    expect(result.deferred_from_experts).toHaveLength(2);
    expect(result.deferred_from_experts[0]!.business_text).toBe(`x${MAX_EXPERT_QUESTIONS}`);
  });

  it('does not ask an expert question already asked by the enrichment (de-dup, no double count)', () => {
    const result = mergeQuestionBatch([q('shared')], [q('Shared'), q('unique')], 5);
    expect(result.questions.map((x) => x.business_text)).toEqual(['shared', 'unique']);
    expect(result.deferred_from_experts).toEqual([]);
  });
});
