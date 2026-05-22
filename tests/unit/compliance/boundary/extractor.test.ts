import { describe, expect, it } from 'vitest';

import { extractUnhandledVariants } from '@/compliance/boundary/extractor.js';
import type { BoundaryInterface } from '@/compliance/boundary/types.js';

function makeBoundary(overrides: Partial<BoundaryInterface> = {}): BoundaryInterface {
  return {
    type_name: 'GateResult',
    file: 'src/types.ts',
    producer_spec: 'integrity-spec',
    consumer_specs: ['output-spec'],
    output_states: ['pass', 'fail', 'warn', 'skip', 'inconclusive'],
    relationship: 'producer_consumer',
    ...overrides,
  };
}

describe('extractUnhandledVariants', () => {
  it('computes unhandled states when consumer spec omits some states (FR-BT2-T3)', () => {
    const boundary = makeBoundary();
    const specTexts = new Map([
      [
        'output-spec',
        'When result is pass, continue. When fail return error. warn means degraded. skip is ignored.',
      ],
    ]);
    const result = extractUnhandledVariants(boundary, specTexts);
    const unhandled = result.unhandled_by_consumer.get('output-spec')!;
    expect(unhandled.map((u) => u.state)).toContain('inconclusive');
    expect(unhandled.map((u) => u.state)).not.toContain('pass');
  });

  it('returns empty unhandled set when consumer handles all states (FR-BT2-T4)', () => {
    const boundary = makeBoundary();
    const specTexts = new Map([
      ['output-spec', 'Handles pass, fail, warn, skip, and inconclusive states.'],
    ]);
    const result = extractUnhandledVariants(boundary, specTexts);
    expect(result.unhandled_by_consumer.get('output-spec')).toHaveLength(0);
  });

  it('treats a missing spec text as empty — all states are unhandled', () => {
    const boundary = makeBoundary();
    const result = extractUnhandledVariants(boundary, new Map());
    const unhandled = result.unhandled_by_consumer.get('output-spec')!;
    expect(unhandled).toHaveLength(5);
  });

  it('handles multiple consumers independently (EC-BT5-T1)', () => {
    const boundary = makeBoundary({ consumer_specs: ['spec-b', 'spec-c'] });
    const specTexts = new Map([
      ['spec-b', 'Handles pass fail warn skip inconclusive.'],
      ['spec-c', 'Only handles pass and fail.'],
    ]);
    const result = extractUnhandledVariants(boundary, specTexts);
    expect(result.unhandled_by_consumer.get('spec-b')).toHaveLength(0);
    expect(result.unhandled_by_consumer.get('spec-c')!.map((u) => u.state)).toContain('warn');
  });

  it('returns empty result when boundary has no consumers', () => {
    const boundary = makeBoundary({ consumer_specs: [] });
    const result = extractUnhandledVariants(boundary, new Map());
    expect(result.unhandled_by_consumer.size).toBe(0);
  });

  it('preserves producer_spec and type_name on unhandled variants', () => {
    const boundary = makeBoundary({ producer_spec: 'my-spec' });
    const result = extractUnhandledVariants(boundary, new Map([['output-spec', '']]));
    const first = result.unhandled_by_consumer.get('output-spec')![0]!;
    expect(first.producer_spec).toBe('my-spec');
    expect(first.type_name).toBe('GateResult');
    expect(first.consumer_spec).toBe('output-spec');
  });

  it('state check is case-insensitive', () => {
    const boundary = makeBoundary({ output_states: ['PASS', 'FAIL'] });
    const specTexts = new Map([['output-spec', 'When result is pass, continue.']]);
    const result = extractUnhandledVariants(boundary, specTexts);
    const unhandled = result.unhandled_by_consumer.get('output-spec')!;
    // 'PASS' should match 'pass' in spec text (case-insensitive comparison)
    expect(unhandled.map((u) => u.state)).not.toContain('PASS');
    expect(unhandled.map((u) => u.state)).toContain('FAIL');
  });
});
