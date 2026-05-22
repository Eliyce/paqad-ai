import { describe, expect, it } from 'vitest';

import { classifyDefect, CLASSIFICATION_RULES } from '@/compliance/defect-patterns/classifier.js';

describe('classifyDefect', () => {
  // D3 — heuristic patterns
  it('classifies threshold/magic-number descriptions as D3.threshold-heuristic', () => {
    expect(classifyDefect('Unspecified threshold value detected', 'D3')).toBe(
      'D3.threshold-heuristic',
    );
    expect(classifyDefect('Magic number 1000 used without spec', 'D3')).toBe(
      'D3.threshold-heuristic',
    );
    expect(classifyDefect('Hard-coded value 42 in comparison', 'D3')).toBe(
      'D3.threshold-heuristic',
    );
  });

  it('classifies type-coercion descriptions as D3.type-coercion-heuristic', () => {
    expect(classifyDefect('instanceof check not in spec', 'D3')).toBe('D3.type-coercion-heuristic');
    expect(classifyDefect('typeof check branch invented', 'D3')).toBe('D3.type-coercion-heuristic');
    expect(classifyDefect('type guard added without obligation', 'D3')).toBe(
      'D3.type-coercion-heuristic',
    );
  });

  // D5 — spec omission patterns
  it('classifies CLI-related descriptions as D5.missing-cli-surface', () => {
    expect(classifyDefect('CLI must expose compliance report command', 'D5')).toBe(
      'D5.missing-cli-surface',
    );
    expect(classifyDefect('Command-line flag --json not implemented', 'D5')).toBe(
      'D5.missing-cli-surface',
    );
    expect(classifyDefect('Subcommand boundary not surfaced', 'D5')).toBe('D5.missing-cli-surface');
  });

  it('classifies boundary/edge descriptions as D5.missing-boundary', () => {
    expect(classifyDefect('Behavior at exactly 2000 chars undefined', 'D5')).toBe(
      'D5.missing-boundary',
    );
    expect(classifyDefect('Off-by-one error at limit', 'D5')).toBe('D5.missing-boundary');
    expect(classifyDefect('Fence-post condition not handled', 'D5')).toBe('D5.missing-boundary');
  });

  it('classifies error-path descriptions as D5.missing-error-handling', () => {
    expect(classifyDefect('Error handling for parse failure missing', 'D5')).toBe(
      'D5.missing-error-handling',
    );
    expect(classifyDefect('Failure case not implemented', 'D5')).toBe('D5.missing-error-handling');
    expect(classifyDefect('Exception not caught per spec', 'D5')).toBe('D5.missing-error-handling');
  });

  it('classifies empty-collection descriptions as D5.missing-empty-case', () => {
    expect(classifyDefect('Empty list input not handled', 'D5')).toBe('D5.missing-empty-case');
    expect(classifyDefect('Zero items case missing', 'D5')).toBe('D5.missing-empty-case');
    expect(classifyDefect('No items in collection', 'D5')).toBe('D5.missing-empty-case');
  });

  it('classifies enum/variant descriptions as D5.missing-enum-variant', () => {
    expect(classifyDefect('Enum variant inconclusive not handled', 'D5')).toBe(
      'D5.missing-enum-variant',
    );
    expect(classifyDefect('All possible states not covered', 'D5')).toBe('D5.missing-enum-variant');
    expect(classifyDefect('State machine transition missing', 'D5')).toBe(
      'D5.missing-enum-variant',
    );
  });

  it('classifies file-path descriptions as D5.wrong-file-path', () => {
    expect(classifyDefect('Wrong file path used in implementation', 'D5')).toBe(
      'D5.wrong-file-path',
    );
    expect(classifyDefect('Incorrect path to config directory', 'D5')).toBe('D5.wrong-file-path');
  });

  it('classifies negative-case descriptions as D5.missing-negative-case', () => {
    expect(classifyDefect('Negative case when not authenticated missing', 'D5')).toBe(
      'D5.missing-negative-case',
    );
    expect(classifyDefect('Otherwise branch undefined', 'D5')).toBe('D5.missing-negative-case');
  });

  it('classifies format-variant descriptions as D5.missing-format-variant', () => {
    expect(classifyDefect('Self-closing tag variant not handled', 'D5')).toBe(
      'D5.missing-format-variant',
    );
    expect(classifyDefect('XML tag parsing incomplete', 'D5')).toBe('D5.missing-format-variant');
    expect(classifyDefect('Alternative format dialect missing', 'D5')).toBe(
      'D5.missing-format-variant',
    );
  });

  // D8 — test quality patterns
  it('classifies tautological test descriptions as D8.tautological-test', () => {
    expect(classifyDefect('Tautological assertion detected', 'D8')).toBe('D8.tautological-test');
    expect(classifyDefect('Test asserts trivial identity', 'D8')).toBe('D8.tautological-test');
  });

  it('classifies mock-only test descriptions as D8.mock-only-test', () => {
    expect(classifyDefect('Mock-only test provides no real coverage', 'D8')).toBe(
      'D8.mock-only-test',
    );
    expect(classifyDefect('Stub-only assertion', 'D8')).toBe('D8.mock-only-test');
  });

  // D1 — unspecified logic
  it('classifies unspecified-logic descriptions as D1.unspecified-logic', () => {
    expect(classifyDefect('Logic not in the spec was added', 'D1')).toBe('D1.unspecified-logic');
    expect(classifyDefect('Invented behavior not documented', 'D1')).toBe('D1.unspecified-logic');
  });

  // D2 — wrong obligation mapping
  it('classifies wrong-obligation descriptions as D2.wrong-obligation-mapping', () => {
    expect(classifyDefect('Wrong obligation ID mapped to this test', 'D2')).toBe(
      'D2.wrong-obligation-mapping',
    );
    expect(classifyDefect('Incorrect obligation reference', 'D2')).toBe(
      'D2.wrong-obligation-mapping',
    );
  });

  // Fallback
  it('falls back to {category}.unclassified when no rule matches', () => {
    expect(classifyDefect('Some totally generic obligation', 'D5')).toBe('D5.unclassified');
    expect(classifyDefect('Unrecognised pattern', 'D9')).toBe('D9.unclassified');
  });

  it('exposes CLASSIFICATION_RULES as an extensible array', () => {
    expect(Array.isArray(CLASSIFICATION_RULES)).toBe(true);
    expect(CLASSIFICATION_RULES.length).toBeGreaterThan(0);
    expect(CLASSIFICATION_RULES[0]).toHaveProperty('pattern');
    expect(CLASSIFICATION_RULES[0]).toHaveProperty('subcategory');
  });
});
