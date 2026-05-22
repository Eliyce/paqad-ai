import { describe, expect, it } from 'vitest';

import {
  buildHeadingPath,
  classifySection,
  makeDeterministicGeneratedId,
  normalizeCell,
  parseHeadings,
  sha256Hex,
  splitLines,
} from '@/compliance/markdown.js';

describe('compliance markdown helpers', () => {
  it('splits CRLF and parses heading paths', () => {
    const lines = splitLines('# Root\r\n\r\n## A\r\n\r\n### B\r\ntext');
    const headings = parseHeadings(lines);

    expect(headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, 'Root', 1],
      [2, 'A', 3],
      [3, 'B', 5],
    ]);

    expect(buildHeadingPath(headings, 6)).toBe('Root > A > B');
    expect(buildHeadingPath(headings, 4)).toBe('Root > A');
  });

  it('classifies sections by path patterns', () => {
    expect(classifySection('Spec > Acceptance Criteria').category).toBe('acceptance');
    expect(classifySection('Spec > 12. Acceptance Criteria').category).toBe('acceptance');
    expect(classifySection('Spec > AC').category).toBe('acceptance');
    expect(classifySection('Spec > Edge Cases').category).toBe('edge-case');
    expect(classifySection('Spec > 10. Edge Cases').category).toBe('edge-case');
    expect(classifySection('Spec > EC-1').category).toBe('edge-case');
    expect(classifySection('Spec > Non-Functional Requirements').category).toBe('non-functional');
    expect(classifySection('Spec > 11. Non-Functional Requirements').category).toBe(
      'non-functional',
    );
    expect(classifySection('Spec > NFR-1').category).toBe('non-functional');
    expect(classifySection('Spec > Functional Requirements').category).toBe('functional');
    expect(classifySection('Spec > 5. Functional Requirements').category).toBe('functional');
    expect(classifySection('Spec > FR-1').category).toBe('functional');
    expect(classifySection('Spec > Misc').category).toBe('unclassified');
  });

  it('buildHeadingPath handles sibling headings by popping the stack', () => {
    const lines = splitLines(['# Root', '', '## A', '', '## B', '', 'Text'].join('\n'));
    const headings = parseHeadings(lines);
    expect(buildHeadingPath(headings, 7)).toBe('Root > B');
  });

  it('generates deterministic IDs and normalizes cells', () => {
    const id1 = makeDeterministicGeneratedId('A > B', 1);
    const id2 = makeDeterministicGeneratedId('A > B', 1);
    expect(id1).toBe(id2);
    expect(id1.startsWith('GEN-')).toBe(true);

    expect(normalizeCell('  hello   world ')).toBe('hello world');
    expect(sha256Hex('x')).toMatch(/^[a-f0-9]{64}$/);
  });
});
