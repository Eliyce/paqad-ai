import { describe, expect, it } from 'vitest';

import { defaultDesignSignOff } from '@/git-workflow/defaults.js';
import { checkHld, countWords, formatHldFindings } from '@/hld/check.js';
import { JARGON } from '@/hld/jargon.js';

const FORMAT = defaultDesignSignOff().format;
const REF = ['PQD', '123'].join('-');

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');
}

function design(summaryExtra: string, detail = 'The parts work together.'): string {
  return [
    `**High-level design for sign-off: ${REF} Faster checkout**`,
    '',
    '**In one line:** Checkout gets one step shorter so buyers finish sooner.',
    '',
    '**What changes for the user**',
    '- The address step is gone.',
    '',
    '**Choices we made**',
    '- We keep the saved address. Why: fewer clicks.',
    '',
    '**Not part of this change:** payment options.',
    '',
    '**To approve:** reply *approved*. Questions? Reply here.',
    summaryExtra,
    '',
    '---',
    '',
    '**More detail**',
    '',
    detail,
  ].join('\n');
}

function exactSummary(target: number): string {
  const base = design('');
  const count = countWords(base.split('\n---\n')[0]!.split('\n'));
  return design(words(target - count));
}

describe('hld check', () => {
  it('AC-14: 200 summary words pass and 201 fail; 800 and 801 detail words the same', () => {
    expect(checkHld(exactSummary(200), FORMAT)).toMatchObject({ ok: true, summary_words: 200 });
    const over = checkHld(exactSummary(201), FORMAT);
    expect(over.ok).toBe(false);
    expect(over.findings.map((f) => f.rule)).toEqual(['summary-length']);

    const detailBase = countWords(['**More detail**']);
    expect(checkHld(design('', words(800 - detailBase)), FORMAT)).toMatchObject({
      ok: true,
      detail_words: 800,
    });
    const long = checkHld(design('', words(801 - detailBase)), FORMAT);
    expect(long.findings.map((f) => f.rule)).toEqual(['detail-length']);
  });

  it('AC-14: markup, arrows, bullets, numbers, pipes and the divider are not words; a ref or link is one', () => {
    expect(countWords(['**Bold** *it*'])).toBe(2);
    expect(countWords(['## Heading here'])).toBe(2);
    expect(countWords(['- one', '2. two', '| a | b |', '|---|---|', '---'])).toBe(4);
    expect(countWords(['Cart → Pay → Done'])).toBe(3);
    expect(countWords([`See ${REF} at https://example.com/a/b?c=d`])).toBe(4);
  });

  it('AC-15: a 260-word summary, a missing section, a file path and an em dash each fail with a line number', () => {
    const long = checkHld(exactSummary(260), FORMAT);
    expect(long.findings[0]).toMatchObject({ rule: 'summary-length', line: 1 });

    for (const section of [
      'In one line',
      'What changes for the user',
      'Choices we made',
      'To approve',
    ]) {
      const missing = checkHld(exactSummary(50).replace(section, 'Something'), FORMAT);
      expect(missing.findings).toContainEqual(
        expect.objectContaining({
          rule: 'missing-section',
          message: `The "${section}" section is missing.`,
        }),
      );
    }

    const path = checkHld(design('It changes src/cart/view and lib/checkout.ts too.'), FORMAT);
    expect(path.findings).toEqual([expect.objectContaining({ rule: 'code', line: 14 })]);

    const dash = checkHld(design('Faster — and simpler.'), FORMAT);
    expect(dash.findings).toEqual([expect.objectContaining({ rule: 'em-dash', line: 14 })]);
    expect(formatHldFindings(dash)).toEqual([
      'line 14: There is an em dash. Use a comma, a full stop or "to" instead.',
    ]);
  });

  it('AC-17: plain phrases, links, refs, product names and near words pass', () => {
    const fine = design(
      `Buyers and/or staff see https://example.com/help, ${REF}, the iPhone view, an inquiry and cached prices.`,
    );
    expect(checkHld(fine, FORMAT)).toMatchObject({ ok: true, findings: [] });
  });

  it.each([['PRs'], ['getJiraIssue'], ['user_name'], ['save('], ['a `tick']])(
    'AC-17: %s fails',
    (text) => {
      const result = checkHld(design(`It uses ${text} here.`), FORMAT);
      expect(result.ok).toBe(false);
      expect(result.findings[0]?.line).toBe(14);
    },
  );

  it('AC-14: a design with no divider counts every word as summary and fails on length', () => {
    const result = checkHld(`${design('').split('\n---\n')[0]}\n${words(200)}`, FORMAT);
    expect(result.ok).toBe(false);
    expect(result.detail_words).toBe(0);
    expect(result.summary_words).toBeGreaterThan(200);
  });

  it('AC-18: a jargon word names its plain replacement', () => {
    const result = checkHld(design('We add a new endpoint and Hooks.'), FORMAT);
    expect(formatHldFindings(result)).toEqual([
      'line 14: "endpoint" is jargon. Say "address" instead.',
      'line 14: "Hooks" is jargon. Say "automatic step" instead.',
    ]);
    for (const entry of JARGON) {
      const hit = checkHld(design(`Mind the ${entry.word} please.`), FORMAT);
      expect(hit.findings[0]?.message).toBe(
        `"${entry.word}" is jargon. Say "${entry.plain}" instead.`,
      );
    }
  });
});
