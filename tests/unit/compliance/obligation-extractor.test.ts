import { describe, expect, it } from 'vitest';

import { extractObligationIndex } from '@/compliance/obligation-extractor.js';

describe('extractObligationIndex', () => {
  it('extracts obligations from recognized test strategy tables losslessly', () => {
    const markdown = [
      '# Spec',
      '',
      '## Functional Requirements',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      '| FR-1-T1 | Parses tables | Unit | All rows become obligations |',
      '| FR-1-T2 | Deterministic | Unit | Same input yields same output |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.metadata.schema_version).toBe(1);
    expect(index.metadata.spec_file).toBe('docs/spec.md');
    expect(index.metadata.obligation_count).toBe(2);
    expect(index.metadata.warnings).toEqual([]);

    expect(index.obligations.map((o) => o.obligation_id)).toEqual(['FR-1-T1', 'FR-1-T2']);
    expect(index.obligations[0]!.pass_criteria).toBe('All rows become obligations');
    expect(index.obligations[0]!.source_line).toBe(7);
    expect(index.obligations[0]!.source_section).toBe('Spec > Functional Requirements');
  });

  it('recognizes an AC-TRACK-<slug> analytics tracking id as an explicit obligation (issue #279)', () => {
    const markdown = [
      '# Spec',
      '',
      '## Acceptance Criteria',
      '',
      'AC-TRACK-song-played: a song_played event is tracked when a song plays.',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.map((o) => o.obligation_id)).toContain('AC-TRACK-song-played');
  });

  it('generates deterministic IDs for numbered list obligations without explicit IDs', () => {
    const markdown = [
      '# Spec',
      '',
      '## Acceptance Criteria',
      '',
      '1. Works for happy path',
      '2. Works for negative path',
      '',
    ].join('\n');

    const index1 = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });
    const index2 = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index1.obligations.length).toBe(2);
    expect(index1.obligations.map((o) => o.obligation_id)).toEqual(
      index2.obligations.map((o) => o.obligation_id),
    );
    expect(index1.obligations[0]!.obligation_id.startsWith('GEN-')).toBe(true);
    expect(index1.obligations[0]!.category).toBe('acceptance');
    expect(index1.obligations[0]!.source_section).toBe('Spec > Acceptance Criteria');
  });

  it('extracts explicit tagged requirements from lines and dedupes against table rows', () => {
    const markdown = [
      '# Spec',
      '',
      '## Functional Requirements',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      '| FR-1-T1 | Parses tables | Unit | OK |',
      '',
      '### FR-2: Something',
      '',
      '**FR-2.1** Some requirement exists.',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    const ids = index.obligations.map((o) => o.obligation_id);
    expect(ids).toContain('FR-1-T1');
    expect(ids).toContain('FR-2');
    expect(ids).toContain('FR-2.1');
    expect(ids.filter((id) => id === 'FR-1-T1').length).toBe(1);
  });

  it('returns an empty index with a warning when no obligations are recognized', () => {
    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: '# Just text\n\nNo tables.\n',
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations).toEqual([]);
    expect(index.metadata.warnings.length).toBe(1);
  });

  it('warns and skips duplicate obligation IDs', () => {
    const markdown = [
      '# Spec',
      '',
      '## Tests',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      '| FR-1-T1 | A | Unit | OK |',
      '| FR-1-T1 | B | Unit | OK |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.map((o) => o.obligation_id)).toEqual(['FR-1-T1']);
    expect(index.metadata.warnings[0]).toMatch('Duplicate obligation_id "FR-1-T1"');
  });

  it('ignores numbered lists outside acceptance sections and example cross-references in prose', () => {
    const markdown = [
      '# Spec',
      '',
      '## Table of Contents',
      '',
      '1. Problem Statement',
      '2. Acceptance Criteria',
      '',
      '## Functional Requirements',
      '',
      '- Example IDs: `FR-1.1`, `AC-3`, `EC-5-T2`.',
      'Cross-reference only: AC-9 is mentioned from another requirement and should not become a new obligation.',
      '',
      '## Acceptance Criteria',
      '',
      '1. Real acceptance obligation',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations).toHaveLength(1);
    expect(index.obligations[0]!.obligation_id.startsWith('GEN-')).toBe(true);
    expect(index.obligations[0]!.source_section).toBe('Spec > Acceptance Criteria');
    expect(index.obligations[0]!.description).toBe('Real acceptance obligation');
  });

  // Bug 7: per-section counter — adding list items in other sections must not
  // shift generated IDs of acceptance-criteria items.
  it('generates stable IDs for AC items regardless of numbered lists in other sections', () => {
    const makeMarkdown = (extraTocItems: string[]) =>
      [
        '# Spec',
        '',
        '## Table of Contents',
        '',
        ...extraTocItems,
        '',
        '## Acceptance Criteria',
        '',
        '1. Real acceptance obligation',
        '',
      ].join('\n');

    const index1 = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: makeMarkdown(['1. Introduction']),
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    // Add a new ToC entry before the AC section — should not change the AC item's ID
    const index2 = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: makeMarkdown(['1. Introduction', '2. Background']),
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index1.obligations).toHaveLength(1);
    expect(index2.obligations).toHaveLength(1);
    expect(index1.obligations[0]!.obligation_id).toBe(index2.obligations[0]!.obligation_id);
  });

  it('parses acceptance criteria tables with three columns into description and pass criteria', () => {
    const markdown = [
      '# Spec',
      '',
      '## 12. Acceptance Criteria',
      '',
      '| # | Criterion | Measurement |',
      '|---|---|---|',
      '| AC-1 | Requirement holds | Verified by tests |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations).toEqual([
      {
        obligation_id: 'AC-1',
        category: 'acceptance',
        description: 'Requirement holds',
        pass_criteria: 'Verified by tests',
        source_section: 'Spec > 12. Acceptance Criteria',
        source_line: 7,
        spec_file: 'docs/spec.md',
        affected_by_spec_defects: [],
      },
    ]);
  });
});
