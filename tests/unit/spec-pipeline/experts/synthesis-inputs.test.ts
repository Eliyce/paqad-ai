import { describe, expect, it } from 'vitest';

import { applyRenames, validateExpertSynthesis } from '@/spec-pipeline/experts/synthesis.js';
import type { MergedExpertNotes } from '@/spec-pipeline/experts/types.js';

const MERGED: MergedExpertNotes = {
  findings: [
    { id: 'EX-qa-1', target: 'export', claim: 'a' },
    { id: 'EX-qa-2', target: 'import', claim: 'b' },
  ],
  conflicts: [],
};

const QUESTION = {
  business_text: 'Who can export?',
  why_it_matters: 'Money data.',
  options: ['Admins', 'Everyone'],
  grounded_in: null,
};

function base(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: 'ready',
    accepted: ['EX-qa-1'],
    declined: [{ id: 'EX-qa-2', reason: 'out of scope' }],
    ...extra,
  };
}

describe('validateExpertSynthesis inputs', () => {
  it.each([
    [
      'an id accepted twice',
      base({ accepted: ['EX-qa-1', 'EX-qa-1'], declined: [] }),
      'finding EX-qa-1 appears twice in accept/decline',
    ],
    [
      'an id accepted and declined',
      base({ declined: [{ id: 'EX-qa-1', reason: 'no' }] }),
      'finding EX-qa-1 appears twice in accept/decline',
    ],
    [
      'questions that are not a list',
      base({ questions: 'q' }),
      'synthesis questions must be an array',
    ],
    [
      'a question without options',
      base({ questions: [{ ...QUESTION, options: [] }] }),
      'synthesis.questions[0] needs a non-empty options[] of strings',
    ],
    ['renames that are not a list', base({ renames: {} }), 'synthesis renames must be an array'],
    [
      'a rename that is not an object',
      base({ renames: [7] }),
      'renames[0] must be an object with id and target',
    ],
    [
      'a gap whose question is not plain',
      base({ gaps: [{ area: 'auth', why_it_matters: 'x', question: 'q' }] }),
      'gaps[0].question must be a question object',
    ],
  ])('rejects %s', (_label, raw, error) => {
    expect(validateExpertSynthesis(raw, MERGED)).toMatchObject({ ok: false, error });
  });

  it('asks for conflicts to be resolved when the merge found some but the synthesis has none', () => {
    const merged: MergedExpertNotes = {
      ...MERGED,
      conflicts: [{ target: 'export', claims: ['a', 'b'] } as never],
    };
    expect(validateExpertSynthesis(base(), merged)).toMatchObject({
      ok: false,
      error: 'synthesis must resolve every merge conflict exactly once',
    });
  });

  it('accepts questions, gap questions and a token count', () => {
    const result = validateExpertSynthesis(
      base({
        questions: [QUESTION],
        gaps: [{ area: 'auth', why_it_matters: 'x', question: QUESTION }],
        tokens: 1200,
      }),
      MERGED,
    );
    expect(result.ok).toBe(true);
    expect(result.artifact).toMatchObject({
      questions: [QUESTION],
      gaps: [{ area: 'auth', why_it_matters: 'x', question: QUESTION }],
      tokens: 1200,
    });
  });

  it('treats findings with no id as one shared empty id', () => {
    const merged: MergedExpertNotes = { findings: [{ target: 't', claim: 'c' }], conflicts: [] };
    expect(
      validateExpertSynthesis({ verdict: 'ready', accepted: [''], declined: [] }, merged).ok,
    ).toBe(true);
  });
});

describe('applyRenames', () => {
  it('leaves findings without an id alone', () => {
    const findings = [{ target: 't', claim: 'c' }];
    expect(applyRenames(findings, [{ id: 'EX-1', target: 'u' }])).toEqual(findings);
  });
});
