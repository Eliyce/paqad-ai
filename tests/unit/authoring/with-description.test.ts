import { describe, expect, it } from 'vitest';

import { hashText, withDescription, withoutDescription } from '@/authoring/hash.js';

const SKILL = [
  '---',
  'name: processing-invoices',
  'description: Parses supplier invoices. Use when an invoice arrives.',
  'model_tier: fast',
  '---',
  '# Processing invoices',
  '',
].join('\n');

describe('withDescription', () => {
  it('leaves the text untouched when the description is unchanged', () => {
    expect(withDescription(SKILL, 'Parses supplier invoices. Use when an invoice arrives.')).toBe(
      SKILL,
    );
  });

  it('replaces a changed description where it stands', () => {
    const next = withDescription(SKILL, 'Parses invoices: totals and VAT. Use when one arrives.');
    expect(next.split('\n').slice(0, 5)).toEqual([
      '---',
      'name: processing-invoices',
      'description: "Parses invoices: totals and VAT. Use when one arrives."',
      'model_tier: fast',
      '---',
    ]);
    expect(hashText(withoutDescription(next))).toBe(hashText(withoutDescription(SKILL)));
  });

  it('replaces a folded description with its continuation lines', () => {
    const folded = SKILL.replace(
      'description: Parses supplier invoices. Use when an invoice arrives.',
      'description: >\n  Parses supplier invoices.\n  Use when an invoice arrives.',
    );
    expect(withDescription(folded, 'New text. Use when asked.').split('\n')[2]).toBe(
      'description: "New text. Use when asked."',
    );
    expect(withDescription(folded, 'New text. Use when asked.').split('\n')[3]).toBe(
      'model_tier: fast',
    );
  });

  it('adds a missing description after the name', () => {
    const bare = SKILL.replace(
      'description: Parses supplier invoices. Use when an invoice arrives.\n',
      '',
    );
    expect(withDescription(bare, 'Parses. Use when asked.').split('\n')[2]).toBe(
      'description: "Parses. Use when asked."',
    );
  });
});
