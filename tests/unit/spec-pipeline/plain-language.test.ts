import { describe, expect, it } from 'vitest';

import { checkPlainLanguage } from '@/spec-pipeline/plain-language.js';
import type { PipelineQuestion } from '@/spec-pipeline/types.js';

const q = (over: Partial<PipelineQuestion>): PipelineQuestion => ({
  business_text: '',
  why_it_matters: 'it matters',
  options: [],
  grounded_in: null,
  ...over,
});

describe('checkPlainLanguage', () => {
  it('flags a table name and "endpoint" not in any project source (FR-4-T1)', () => {
    const r = checkPlainLanguage(q({ business_text: 'Should the orders_2024 endpoint stay?' }), {
      terms: [],
      prompt: 'make the report cleaner',
    });
    expect(r.ok).toBe(false);
    expect(r.flagged).toContain('endpoint');
    expect(r.flagged).toContain('orders_2024');
  });

  it("passes wording drawn from the project's documented vocabulary (FR-4-T2)", () => {
    const r = checkPlainLanguage(
      q({
        business_text: 'Should archived invoices stay in the export?',
        options: ['keep archived invoices', 'leave them out'],
      }),
      { terms: ['archived invoices', 'export'], prompt: 'clean up the export' },
    );
    expect(r.ok).toBe(true);
    expect(r.flagged).toEqual([]);
  });

  it('flags mechanism phrasing in options but passes outcome phrasing (FR-4-T6)', () => {
    const mech = checkPlainLanguage(
      q({
        business_text: 'How should it behave on failure?',
        options: ['exponential backoff', 'circuit breaker'],
      }),
      { terms: [], prompt: 'handle failures' },
    );
    expect(mech.ok).toBe(false);
    expect(mech.flagged).toEqual(
      expect.arrayContaining(['exponential backoff', 'circuit breaker']),
    );

    const outcome = checkPlainLanguage(
      q({
        business_text: 'How should it behave on failure?',
        options: [
          'keep trying quietly for an hour, then notify someone',
          'stop right away and show an error',
        ],
      }),
      { terms: [], prompt: 'handle failures' },
    );
    expect(outcome.ok).toBe(true);
  });

  it('allows a technical-looking token when it appears in the project sources', () => {
    const r = checkPlainLanguage(q({ business_text: 'Should the GET stay?' }), {
      terms: [],
      prompt: 'the GET should stay',
    });
    expect(r.flagged).not.toContain('GET');
  });

  it('is deterministic', () => {
    const question = q({ business_text: 'Use the webhook or not?', options: ['poll instead'] });
    const sources = { terms: [], prompt: 'notifications' };
    expect(checkPlainLanguage(question, sources)).toEqual(checkPlainLanguage(question, sources));
  });
});
