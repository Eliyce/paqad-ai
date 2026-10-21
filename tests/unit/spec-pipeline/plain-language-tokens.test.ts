import { describe, expect, it } from 'vitest';

import { checkPlainLanguage } from '@/spec-pipeline/plain-language.js';

function flagged(text: string): string[] {
  return checkPlainLanguage(
    { business_text: text, why_it_matters: 'w', options: ['yes'], grounded_in: null },
    { prompt: '', terms: [] },
  ).flagged;
}

describe('checkPlainLanguage token rules', () => {
  it.each([
    ['a camelCase name', 'Should userId change?', ['userId']],
    ['a path', 'Edit src/billing please?', ['src/billing']],
    ['a file extension', 'Rename index.ts now?', ['index.ts']],
    ['a call', 'Run save( now?', ['save(']],
    ['letters with digits', 'Use v2 here?', ['v2']],
    ['an HTTP status', 'Return 404 then?', ['404']],
  ])('flags %s', (_label, text, expected) => {
    expect(flagged(text)).toEqual(expected);
  });

  it('ignores punctuation-only tokens and plain words', () => {
    expect(flagged('Who — exactly — can see it ?')).toEqual([]);
  });

  it('allows a technical token the request already used', () => {
    expect(
      checkPlainLanguage(
        {
          business_text: 'Keep the userId?',
          why_it_matters: 'w',
          options: ['yes'],
          grounded_in: null,
        },
        { prompt: 'Rename userId', terms: [], vocabulary: ['--'] },
      ),
    ).toEqual({ ok: true, flagged: [] });
  });
});
