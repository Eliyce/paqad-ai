import { describe, expect, it } from 'vitest';

import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';
import { checkSpecShape, PARITY_CORPUS } from '@/spec-pipeline/parser-parity.js';

describe('checkSpecShape', () => {
  it('accepts a well-formed flat spec', () => {
    const r = checkSpecShape(PARITY_CORPUS[0]!.markdown);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('rejects a dotted AC id, naming the problem (EC-11 sibling of C4)', () => {
    const r = checkSpecShape(
      ['## Acceptance criteria', '- AC-1.1: Given a, when b, then c (proof: automated).'].join('\n'),
    );
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => /dotted/.test(p))).toBe(true);
  });

  it('rejects an unrecognized heading naming the recognized set (EC-11)', () => {
    const r = checkSpecShape(
      ['## Wibble', 'FR-1: x.', '## Acceptance criteria', '- AC-1: Given a, when b, then c (proof: automated).'].join('\n'),
    );
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => /unrecognized heading "Wibble"/.test(p))).toBe(true);
  });

  it('flags a spec with no acceptance criteria', () => {
    const r = checkSpecShape('## Functional requirements\nFR-1: x.\n');
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => /no acceptance criteria/.test(p))).toBe(true);
  });
});

// FR-10.2 — the shared corpus must pass BOTH the S4 shape check AND the real freeze parser,
// so the two can never drift apart.
describe('parity corpus (S4 check ↔ freeze parser)', () => {
  for (const fixture of PARITY_CORPUS) {
    it(`"${fixture.name}" passes the S4 shape check`, () => {
      expect(checkSpecShape(fixture.markdown).ok).toBe(true);
    });

    it(`"${fixture.name}" is ingested cleanly by the freeze parser`, () => {
      const spec = buildFeatureSpec({
        spec_id: 'S-corpus',
        spec_file: '.paqad/_specs/corpus.md',
        spec_markdown: fixture.markdown,
      });
      expect(spec.behaviour.length).toBeGreaterThan(0);
      expect(spec.acceptance_criteria.length).toBeGreaterThan(0);
      for (const c of spec.acceptance_criteria) {
        expect(c.criterion_id).toMatch(/^AC-\d+$/);
        expect(c.proof_type).toBeTruthy();
      }
    });
  }
});
