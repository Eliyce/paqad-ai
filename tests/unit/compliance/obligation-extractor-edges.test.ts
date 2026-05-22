import { describe, expect, it } from 'vitest';

import { extractObligationIndex } from '@/compliance/obligation-extractor.js';

describe('extractObligationIndex edge cases', () => {
  it('ignores tables that do not match obligation header patterns', () => {
    const markdown = ['# Spec', '', '| Name | Value |', '|---|---|', '| Foo | Bar |', ''].join(
      '\n',
    );

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.length).toBe(0);
    expect(index.metadata.warnings.length).toBe(1);
  });

  it('skips malformed tables missing a separator row', () => {
    const markdown = [
      '# Spec',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '| FR-1-T1 | A | Unit | OK |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    // The table is ignored, but explicit tagged requirements are still extracted.
    expect(index.obligations.map((o) => o.obligation_id)).toEqual(['FR-1-T1']);
  });

  it('extracts NFR and EC tagged requirements including -T suffixes', () => {
    const markdown = [
      '# Spec',
      '',
      'NFR-2.1 must hold.',
      'EC-5-T2 should be covered.',
      'NFR-1-T4 fixture generation timing.',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.map((o) => o.obligation_id)).toEqual([
      'EC-5-T2',
      'NFR-1-T4',
      'NFR-2.1',
    ]);
  });

  it('skips recognized table headers at EOF without a separator row', () => {
    const markdown = ['# Spec', '', '| Test ID | Condition | Method | Pass Criteria |'].join('\n');
    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });
    expect(index.obligations).toEqual([]);
  });

  it('does not treat near-miss tables as obligation sources', () => {
    const markdown = [
      '# Spec',
      '',
      // Has ID + Pass, missing Condition/Criterion keyword.
      '| Test ID | Foo | Bar | Pass Criteria |',
      '|---|---|---|---|',
      '| FR-1-T1 | A | Unit | OK |',
      '',
      // Has ID + Condition, missing Pass keyword.
      '| Test ID | Condition | Method | Output |',
      '|---|---|---|---|',
      '| FR-1-T2 | A | Unit | OK |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    // These IDs still show up via explicit tag scanning, but not via table parsing.
    expect(index.obligations.map((o) => o.obligation_id)).toEqual(['FR-1-T1', 'FR-1-T2']);
    expect(index.obligations.every((o) => o.pass_criteria === null)).toBe(true);
  });

  it('treats lines that start with "|" but do not end with "|" as non-table rows', () => {
    const markdown = [
      '# Spec',
      '',
      '| this is not a table row',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      '| FR-1-T1 | A | Unit | OK |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.map((o) => o.obligation_id)).toEqual(['FR-1-T1']);
    expect(index.obligations[0]!.pass_criteria).toBe('OK');
  });
});
