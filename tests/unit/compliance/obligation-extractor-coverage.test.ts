import { describe, expect, it } from 'vitest';

import { extractObligationIndex } from '@/compliance/obligation-extractor.js';
import { makeDeterministicGeneratedId } from '@/compliance/markdown.js';

describe('extractObligationIndex coverage paths', () => {
  it('skips malformed/empty rows and exercises fallback table parsing', () => {
    const markdown = [
      '# Spec',
      '',
      '## Tests',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      '|   |   |   |   |',
      '| X |',
      '|   | Description only | Unit | OK |',
      '| FR-1-T2 |  | Desc from third |',
      '| FR-1-T3 | Desc | Unit | OK |',
      'Not a table row anymore',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '| not-a-separator |',
      '| FR-2-T1 | X | Unit | OK |',
      '',
      '| Name | Value |',
      '|---|---|',
      '| FR-9-T1 | This table is ignored |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    const ids = index.obligations.map((o) => o.obligation_id);
    expect(ids).toContain('FR-1-T2');
    expect(ids).toContain('FR-1-T3');
    expect(index.obligations.find((o) => o.obligation_id === 'FR-1-T2')!.pass_criteria).toBeNull();
    expect(index.obligations.find((o) => o.obligation_id === 'FR-1-T2')!.description).toBe(
      'Desc from third',
    );
  });

  it('skips generated IDs that collide with existing table obligation IDs', () => {
    const sectionPath = 'Spec > Acceptance Criteria';
    const genId = makeDeterministicGeneratedId(sectionPath, 1);

    const markdown = [
      '# Spec',
      '',
      '## Acceptance Criteria',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      `| ${genId} | Placeholder | Unit | OK |`,
      '',
      '1. This would normally generate the same ID',
      '',
      `${genId} is referenced explicitly too.`,
      `${genId} is referenced explicitly too.`,
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    const ids = index.obligations.map((o) => o.obligation_id);
    expect(ids).toEqual([genId]);
  });

  it('dedupes explicit IDs against existing obligations and repeated lines', () => {
    const markdown = [
      '# Spec',
      '',
      '## Tests',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      '| FR-1-T1 |   |   |   |',
      '',
      'FR-1-T1 appears again in prose and should be ignored.',
      'FR-2.1 appears twice and should only create one obligation.',
      'FR-2.1 appears twice and should only create one obligation.',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.map((o) => o.obligation_id)).toEqual(['FR-1-T1', 'FR-2.1']);
    expect(index.obligations.find((o) => o.obligation_id === 'FR-1-T1')!.description).toBe('');
    expect(index.obligations.find((o) => o.obligation_id === 'FR-1-T1')!.pass_criteria).toBeNull();
  });

  it('uses three-column fallback mapping when descriptive or pass keywords appear in the first header cell', () => {
    const markdown = [
      '# Spec',
      '',
      '## Acceptance Criteria',
      '',
      '| Case ID | Output | Pass Criteria |',
      '|---|---|---|',
      '| AC-1 | Description from second cell | Pass from third cell |',
      '',
      '| Result ID | Condition | Notes |',
      '|---|---|---|',
      '| AC-2 | Description from second cell | Pass from third cell |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.find((o) => o.obligation_id === 'AC-1')).toMatchObject({
      description: 'Description from second cell',
      pass_criteria: 'Pass from third cell',
    });
    expect(index.obligations.find((o) => o.obligation_id === 'AC-2')).toMatchObject({
      description: 'Description from second cell',
      pass_criteria: 'Pass from third cell',
    });
  });

  it('falls back across secondary and tertiary columns when header inference cannot identify them directly', () => {
    const markdown = [
      '# Spec',
      '',
      '## Acceptance Criteria',
      '',
      '| Case ID | Output | Pass Criteria |',
      '|---|---|---|',
      '| AC-3 |  | Description recovered from third cell |',
      '| AC-6 |  |  |',
      '',
      '| Result ID | Condition | Notes | Extra |',
      '|---|---|---|---|',
      '| AC-4 | Description from second cell | Pass recovered from third cell |  |',
      '| AC-5 | Description from second cell |  | Pass recovered from fourth cell |',
      '| AC-7 | Description from second cell |  |  |',
      '',
    ].join('\n');

    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      extracted_at: '2026-04-07T00:00:00.000Z',
    });

    expect(index.obligations.find((o) => o.obligation_id === 'AC-3')).toMatchObject({
      description: 'Description recovered from third cell',
      pass_criteria: 'Description recovered from third cell',
    });
    expect(index.obligations.find((o) => o.obligation_id === 'AC-4')).toMatchObject({
      pass_criteria: 'Pass recovered from third cell',
    });
    expect(index.obligations.find((o) => o.obligation_id === 'AC-5')).toMatchObject({
      pass_criteria: 'Pass recovered from fourth cell',
    });
    expect(index.obligations.find((o) => o.obligation_id === 'AC-6')).toMatchObject({
      description: '',
      pass_criteria: null,
    });
    expect(index.obligations.find((o) => o.obligation_id === 'AC-7')).toMatchObject({
      pass_criteria: null,
    });
  });
});
