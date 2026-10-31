import { format } from 'prettier';
import { describe, expect, it } from 'vitest';

import { hashText, withDescription, withoutDescription } from '@/authoring/hash.js';

const SKILL = [
  '---',
  'name: processing-invoices',
  'description: Parses supplier invoices. Use when an invoice arrives.',
  'model_tier: fast',
  '---',
  '',
  '# Processing invoices',
  '',
].join('\n');

const DESCRIPTIONS = [
  'Parses supplier invoices. Use when one arrives.',
  'Parses invoices: totals and VAT. Use when one arrives.',
  "Reads one expert's brief: findings plus questions. Use when a seat needs notes.",
  'Says "hello" and \'bye\' # politely. Use when greeting.',
  'yes',
];

describe('withDescription', () => {
  it('leaves the text untouched when the description is unchanged', () => {
    expect(withDescription(SKILL, 'Parses supplier invoices. Use when an invoice arrives.')).toBe(
      SKILL,
    );
  });

  it('writes a plain scalar where it stands when YAML reads it back unchanged', () => {
    const next = withDescription(SKILL, 'New text, shorter. Use when one arrives.');
    expect(next.split('\n').slice(0, 5)).toEqual([
      '---',
      'name: processing-invoices',
      'description: New text, shorter. Use when one arrives.',
      'model_tier: fast',
      '---',
    ]);
  });

  it('writes a folded block when a plain scalar would not read back', () => {
    const next = withDescription(SKILL, 'Parses invoices: totals and VAT. Use when one arrives.');
    expect(next.split('\n').slice(2, 5)).toEqual([
      'description: >-',
      '  Parses invoices: totals and VAT. Use when one arrives.',
      'model_tier: fast',
    ]);
    expect(hashText(withoutDescription(next))).toBe(hashText(withoutDescription(SKILL)));
  });

  it('replaces a folded description with its continuation lines', () => {
    const folded = SKILL.replace(
      'description: Parses supplier invoices. Use when an invoice arrives.',
      'description: >\n  Parses supplier invoices.\n  Use when an invoice arrives.',
    );
    const next = withDescription(folded, 'New text. Use when asked.').split('\n');
    expect(next.slice(2, 4)).toEqual([
      'description: New text. Use when asked.',
      'model_tier: fast',
    ]);
  });

  it('adds a missing description after the name', () => {
    const bare = SKILL.replace(
      'description: Parses supplier invoices. Use when an invoice arrives.\n',
      '',
    );
    expect(withDescription(bare, 'Parses. Use when asked.').split('\n')[2]).toBe(
      'description: Parses. Use when asked.',
    );
  });

  it.each(DESCRIPTIONS)(
    'writes "%s" so it reads back and a prettier run leaves it alone',
    async (text) => {
      const next = withDescription(SKILL, text);
      expect(withDescription(next, text)).toBe(next);
      for (const options of [{}, { singleQuote: true }]) {
        expect(await format(next, { parser: 'markdown', ...options })).toBe(next);
      }
    },
  );
});
