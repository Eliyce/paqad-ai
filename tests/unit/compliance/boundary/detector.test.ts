import { describe, expect, it } from 'vitest';

import { detectBoundariesInSource } from '@/compliance/boundary/detector.js';

describe('detectBoundariesInSource', () => {
  it('detects a boundary from an annotation with explicit states', () => {
    const source = `
// @boundary GateResult producer:integrity-spec consumer:output-spec states:pass,fail,warn
export type GateResult = 'pass' | 'fail' | 'warn';
`.trim();
    const results = detectBoundariesInSource('src/types.ts', source);
    expect(results).toHaveLength(1);
    expect(results[0]!.type_name).toBe('GateResult');
    expect(results[0]!.producer_spec).toBe('integrity-spec');
    expect(results[0]!.consumer_specs).toEqual(['output-spec']);
    expect(results[0]!.output_states).toEqual(['pass', 'fail', 'warn']);
    expect(results[0]!.relationship).toBe('producer_consumer');
    expect(results[0]!.file).toBe('src/types.ts');
  });

  it('extracts states from a TypeScript union type when no explicit states given', () => {
    const source = `
// @boundary ParseResult producer:parser-spec consumer:gate-spec
export type ParseResult = 'structured' | 'plain-text-fallback' | 'degraded';
`.trim();
    const results = detectBoundariesInSource('src/parser.ts', source);
    expect(results[0]!.output_states).toEqual(['structured', 'plain-text-fallback', 'degraded']);
  });

  it('extracts states from a TypeScript enum', () => {
    const source = `
// @boundary ComplianceState producer:checker-spec consumer:gate-spec
export enum ComplianceState {
  Covered = 'covered',
  Uncovered = 'uncovered',
  Partial = 'partial',
  Indeterminate = 'indeterminate',
}
`.trim();
    const results = detectBoundariesInSource('src/types.ts', source);
    expect(results[0]!.output_states).toContain('Covered');
    expect(results[0]!.output_states).toContain('Uncovered');
    expect(results[0]!.output_states).toContain('Partial');
    expect(results[0]!.output_states).toContain('Indeterminate');
  });

  it('extracts states from identifier unions', () => {
    const source = `
// @boundary ParseState producer:parser-spec consumer:gate-spec
export type ParseState = Parsed | Failed | Retried;
`.trim();
    const results = detectBoundariesInSource('src/parser.ts', source);
    expect(results[0]!.output_states).toEqual(['Parsed', 'Failed', 'Retried']);
  });

  it('skips empty union segments and reserved enum tokens while parsing states', () => {
    const source = `
// @boundary ParseState producer:parser-spec consumer:gate-spec
export type ParseState = Parsed |  | Failed;
// @boundary WeirdEnum producer:parser-spec consumer:gate-spec
export enum WeirdEnum {
  const,
  Valid,
}
`.trim();
    const results = detectBoundariesInSource('src/parser.ts', source);
    expect(results[0]!.output_states).toEqual(['Parsed', 'Failed']);
    expect(results[1]!.output_states).toContain('Valid');
    expect(results[1]!.output_states).not.toContain('const');
  });

  it('classifies as producer_consumer when both producer and consumer specified', () => {
    const source = `// @boundary Foo producer:spec-a consumer:spec-b states:x,y`;
    const [result] = detectBoundariesInSource('src/foo.ts', source);
    expect(result!.relationship).toBe('producer_consumer');
  });

  it('classifies as shared_utility when no producer or consumer specified', () => {
    const source = `// @boundary Bar states:a,b`;
    const [result] = detectBoundariesInSource('src/bar.ts', source);
    expect(result!.relationship).toBe('shared_utility');
  });

  it('classifies as shared_utility when only producer is specified', () => {
    const source = `// @boundary Solo producer:spec-a states:a,b`;
    const [result] = detectBoundariesInSource('src/solo.ts', source);
    expect(result!.relationship).toBe('shared_utility');
  });

  it('classifies as unanalyzable when no states can be extracted', () => {
    const source = `
// @boundary Mystery producer:spec-a consumer:spec-b
export const mystery = {};
`.trim();
    const [result] = detectBoundariesInSource('src/mystery.ts', source);
    expect(result!.relationship).toBe('unanalyzable');
    expect(result!.output_states).toEqual([]);
  });

  it('handles multiple @boundary annotations in one file', () => {
    const source = `
// @boundary TypeA producer:a consumer:b states:x,y
export type TypeA = 'x' | 'y';

// @boundary TypeB producer:c consumer:d states:p,q,r
export type TypeB = 'p' | 'q' | 'r';
`.trim();
    const results = detectBoundariesInSource('src/multi.ts', source);
    expect(results).toHaveLength(2);
    expect(results[0]!.type_name).toBe('TypeA');
    expect(results[1]!.type_name).toBe('TypeB');
  });

  it('returns empty array when no annotations are present', () => {
    const source = `export type Foo = 'a' | 'b';`;
    expect(detectBoundariesInSource('src/foo.ts', source)).toEqual([]);
  });

  it('handles multiple consumer specs (comma-separated)', () => {
    const source = `// @boundary Evt producer:spec-a consumer:spec-b,spec-c states:start,stop`;
    const [result] = detectBoundariesInSource('src/evt.ts', source);
    expect(result!.consumer_specs).toEqual(['spec-b', 'spec-c']);
  });

  it('handles annotation with no subsequent type definition (empty states)', () => {
    const source = `// @boundary NoType producer:a consumer:b`;
    const [result] = detectBoundariesInSource('src/notype.ts', source);
    expect(result!.output_states).toEqual([]);
  });

  it('handles annotation at the last line of the file gracefully', () => {
    const source = `const x = 1;\n// @boundary Last producer:a consumer:b states:x`;
    expect(() => detectBoundariesInSource('src/last.ts', source)).not.toThrow();
  });
});
