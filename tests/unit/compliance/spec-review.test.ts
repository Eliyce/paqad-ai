import { describe, expect, it } from 'vitest';

import { extractObligationIndex } from '@/compliance/obligation-extractor.js';
import {
  attachSpecDefectsToObligations,
  compareDefects,
  reviewSpecification,
} from '@/compliance/spec-review.js';
import { boundaryDetector } from '@/compliance/spec-review-detectors/boundary-detector.js';
import { contradictionDetector } from '@/compliance/spec-review-detectors/contradiction-detector.js';
import {
  hasNegativePath,
  missingNegativeDetector,
} from '@/compliance/spec-review-detectors/missing-negative-detector.js';
import { dedupeByLineAndCategory } from '@/compliance/spec-review-detectors/reference-detector.js';
import type { ReviewContext } from '@/compliance/spec-review-detectors/types.js';
import { SPEC_REVIEW_DETECTOR_INTERFACE_VERSION } from '@/compliance/spec-review-detectors/types.js';

function makeContext(lines: string[]): ReviewContext {
  return {
    spec_file: 'docs/spec.md',
    spec_markdown: lines.join('\n'),
    lines,
    review_lines: lines.map((text, index) => ({
      line: index + 1,
      text,
      section: 'Spec',
    })),
  };
}

describe('reviewSpecification', () => {
  it('detects the canonical defect categories deterministically', () => {
    const markdown = [
      '# Spec',
      '',
      '## Functional Requirements',
      '',
      'FR-SQ-1 compliance_ratio = covered / total',
      'FR-SQ-2 indeterminate obligations must be excluded from the denominator',
      'FR-SQ-3 ratio = covered / (total - indeterminate)',
      'FR-SQ-4 all obligations may be indeterminate',
      'FR-SQ-5 extraction must be lossless',
      'FR-SQ-6 non-matching tables must be ignored',
      'FR-SQ-7 field has a maximum length of 2,000 characters',
      'FR-SQ-8 truncate at 2,000 chars and append truncation marker',
      'FR-SQ-9 when compliance is 100%, return pass',
      'AC-SQ-5 references EC-SQ-10 for follow-up coverage',
      'See RAG spec for embedding provider contract.',
      '',
    ].join('\n');

    const reportA = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      reviewed_at: '2026-04-08T00:00:00.000Z',
    });
    const reportB = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      reviewed_at: '2026-04-08T00:00:00.000Z',
    });

    expect(reportA).toEqual(reportB);
    expect(reportA.metadata.defect_count).toBe(7);
    expect(reportA.defects.filter((defect) => defect.status !== 'resolved')).toHaveLength(7);
    expect(new Set(reportA.defects.map((defect) => defect.category))).toEqual(
      new Set([
        'contradiction',
        'formula_inconsistency',
        'boundary_gap',
        'goal_conflict',
        'dangling_reference',
        'missing_negative_case',
        'unresolvable_reference',
      ]),
    );
    expect(reportA.defects[0]!.severity).toBe('critical');
    expect(reportA.pattern_advisories).toEqual([]);
  });

  it('carries resolved defects forward on subsequent reviews', () => {
    const original = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'FR-SQ-1 compliance_ratio = covered / total',
        'FR-SQ-2 indeterminate obligations must be excluded from the denominator',
        '',
      ].join('\n'),
      reviewed_at: '2026-04-08T00:00:00.000Z',
    });

    const updated = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'FR-SQ-1 compliance_ratio = covered / (total - indeterminate)',
        '',
      ].join('\n'),
      reviewed_at: '2026-04-09T00:00:00.000Z',
      previous_report: original,
    });

    expect(updated.metadata.defect_count).toBe(0);
    expect(updated.defects).toHaveLength(1);
    expect(updated.defects[0]!.status).toBe('resolved');
  });

  it('marks unchanged defects as existing and handles specs without headings', () => {
    const markdown = 'See RAG spec for embedding provider contract.\n';
    const first = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      reviewed_at: '2026-04-08T00:00:00.000Z',
    });
    const second = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      reviewed_at: '2026-04-09T00:00:00.000Z',
      previous_report: first,
    });

    expect(second.defects).toHaveLength(1);
    expect(second.defects[0]!.status).toBe('existing');
    expect(second.defects[0]!.locations[0]!.section).toBe('Spec');
  });

  it('excludes open questions and TBD markers from defect detection', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        '## Open Questions',
        '',
        'OQ-1 compliance_ratio = covered / total',
        'OQ-2 indeterminate obligations must be excluded from the denominator',
        '',
        '## Functional Requirements',
        '',
        'FR-SQ-1 Boundary behavior is TBD',
        '',
      ].join('\n'),
    });

    expect(report.metadata.defect_count).toBe(0);
    expect(report.defects).toEqual([]);
  });

  it('propagates defect ids onto obligations extracted from affected lines', () => {
    const markdown = [
      '# Spec',
      '',
      '## Functional Requirements',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      '| FR-SQ1-T1 | compliance_ratio = covered / total | Unit | OK |',
      '| FR-SQ1-T2 | indeterminate obligations must be excluded from the denominator | Unit | OK |',
      '',
    ].join('\n');
    const review = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
    });
    const index = extractObligationIndex({
      spec_file: 'docs/spec.md',
      spec_markdown: markdown,
      spec_review: review,
    });

    expect(index.obligations).toHaveLength(2);
    expect(index.obligations[0]!.affected_by_spec_defects).toHaveLength(1);
    expect(index.obligations[1]!.affected_by_spec_defects).toHaveLength(1);
  });

  it('detects prose always-versus-never contradictions and covers detector metadata exports', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'The parser must always emit "structured".',
        'The parser must never emit "structured".',
        '',
      ].join('\n'),
    });

    expect(SPEC_REVIEW_DETECTOR_INTERFACE_VERSION).toBe(1);
    expect(report.defects).toHaveLength(1);
    expect(report.defects[0]!.category).toBe('contradiction');
  });

  it('sorts same-severity same-line defects deterministically and preserves resolved defect mappings', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'FR-1 when compliance is 100%, return pass and see EC-9.',
        '',
      ].join('\n'),
    });

    expect(report.defects).toHaveLength(2);
    expect(report.defects[0]!.defect_id.localeCompare(report.defects[1]!.defect_id)).toBeLessThan(
      0,
    );

    const linked = attachSpecDefectsToObligations(
      {
        ...report,
        defects: report.defects.map((defect) => ({ ...defect, status: 'resolved' as const })),
      },
      [],
    );
    expect(linked.defects.every((defect) => Array.isArray(defect.affected_obligation_ids))).toBe(
      true,
    );
  });

  it('dedupes repeated dangling references emitted from the same line', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: ['# Spec', '', 'AC-1 references EC-9 and EC-9 again.', ''].join('\n'),
    });

    expect(report.defects).toHaveLength(1);
    expect(report.defects[0]!.category).toBe('dangling_reference');
  });

  it('emits prose contradictions when always and never share an unquoted subject', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'The parser must always emit structured output.',
        'The parser must never emit structured output.',
        '',
      ].join('\n'),
    });

    expect(report.defects).toHaveLength(1);
    expect(report.defects[0]!.category).toBe('contradiction');
  });

  it('does not emit prose contradictions when always/never statements have no shared subject', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'The parser must always produce structured output.',
        'The gateway must never allow batched responses.',
        '',
      ].join('\n'),
    });

    expect(report.defects).toEqual([]);
  });

  it('keeps distinct dangling references on the same line', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: ['# Spec', '', 'AC-1 references EC-9 and EC-10.', ''].join('\n'),
    });

    expect(report.defects).toHaveLength(2);
    expect(report.defects.every((d) => d.category === 'dangling_reference')).toBe(true);
  });

  it('does not emit a boundary defect when exact boundary behavior is explicitly defined', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'FR-1 field has a maximum length of 2000 characters.',
        'FR-2 At exactly 2000 characters, preserve the value.',
        'FR-3 Truncate above 2000 characters and append a marker.',
        '',
      ].join('\n'),
    });

    expect(report.defects.some((defect) => defect.category === 'boundary_gap')).toBe(false);
  });

  it('does not emit a missing-negative defect when the negative path is specified', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'FR-1 when compliance is 100%, return pass.',
        'FR-2 otherwise, return warn.',
        '',
      ].join('\n'),
    });

    expect(report.defects).toEqual([]);
  });

  it('sorts same-severity defects by line number before defect id', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'FR-1 when compliance is 100%, return pass.',
        'FR-2 references EC-9.',
        '',
      ].join('\n'),
    });

    expect(report.defects).toHaveLength(2);
    expect(report.defects[0]!.locations[0]!.line_range[0]).toBeLessThan(
      report.defects[1]!.locations[0]!.line_range[0],
    );
  });

  it('sorts defects with missing locations ahead of later same-severity defects', () => {
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: ['# Spec', '', 'FR-1 when compliance is 100%, return pass.', ''].join('\n'),
      previous_report: {
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          reviewed_at: '2026-04-07T00:00:00.000Z',
          defect_count: 1,
          schema_version: 1,
        },
        defects: [
          {
            defect_id: 'SQ-OLD',
            category: 'boundary_gap',
            severity: 'major',
            description: 'Resolved defect without a location',
            locations: [],
            suggested_resolution: 'Fix',
            affected_obligation_ids: [],
            status: 'new',
          },
        ],
        pattern_advisories: [],
      },
    });

    expect(report.defects).toHaveLength(2);
    expect(report.defects[0]!.defect_id).toBe('SQ-OLD');
    expect(report.defects[0]!.status).toBe('resolved');
  });

  it('compares same-severity defects when the right-hand defect has no location', () => {
    expect(
      compareDefects(
        {
          defect_id: 'SQ-B',
          category: 'boundary_gap',
          severity: 'major',
          description: 'Located',
          locations: [{ section: 'Spec', line_range: [3, 3], text_excerpt: 'x' }],
          suggested_resolution: 'Fix',
          affected_obligation_ids: [],
          status: 'new',
        },
        {
          defect_id: 'SQ-A',
          category: 'boundary_gap',
          severity: 'major',
          description: 'Unlocated',
          locations: [],
          suggested_resolution: 'Fix',
          affected_obligation_ids: [],
          status: 'new',
        },
      ),
    ).toBeGreaterThan(0);
  });
});

describe('spec review detectors', () => {
  it('skips boundary defects when the limit line already states exact behavior', () => {
    const defects = boundaryDetector.detect(
      makeContext(['Maximum length is 2000 characters inclusive.']),
    );

    expect(defects).toEqual([]);
  });

  it('skips same-line always/never contradictions after extracting a quoted subject', () => {
    const defects = contradictionDetector.detect(
      makeContext(['The parser must always emit "structured" and never omit "structured".']),
    );

    expect(defects).toEqual([]);
  });

  it('skips prose contradictions when the quoted subject is not shared by both lines', () => {
    const defects = contradictionDetector.detect(
      makeContext([
        'The parser must always emit "structured".',
        'The parser must never emit binary output.',
      ]),
    );

    expect(defects).toEqual([]);
  });

  it('accepts alternate negative-path wording without emitting a missing-negative defect', () => {
    const defects = missingNegativeDetector.detect(
      makeContext(['When compliance is below threshold, return fail.', 'If not, return warn.']),
    );

    expect(defects).toEqual([]);
  });

  it('accepts indeterminate-all wording as a valid negative path', () => {
    const defects = missingNegativeDetector.detect(
      makeContext([
        'When compliance is 100%, return pass.',
        'All obligations are indeterminate, return warn.',
      ]),
    );

    expect(defects).toEqual([]);
  });

  it('accepts multiple alternate negative-path phrases without emitting a defect', () => {
    const contexts = [
      makeContext(['When compliance is 100%, return pass.', 'When not applicable, return fail.']),
      makeContext(['When compliance is 100%, return pass.', 'Else return skip.']),
      makeContext([
        'When compliance is 100%, return pass.',
        'All obligations are indeterminate and must fail closed.',
      ]),
    ];

    for (const context of contexts) {
      expect(missingNegativeDetector.detect(context)).toEqual([]);
    }
  });

  it('recognizes every supported negative-path phrase and rejects unrelated text', () => {
    expect(hasNegativePath('when not applicable, return fail.')).toBe(true);
    expect(hasNegativePath('otherwise return warn.')).toBe(true);
    expect(hasNegativePath('else return skip.')).toBe(true);
    expect(hasNegativePath('if not, return pass.')).toBe(true);
    expect(hasNegativePath('all obligations are indeterminate and must fail closed.')).toBe(true);
    expect(hasNegativePath('return pass when conditions hold.')).toBe(false);
  });

  it('recognizes each indeterminate-all action verb as a negative path', () => {
    expect(hasNegativePath('all obligations are indeterminate, return a warning.')).toBe(true);
    expect(hasNegativePath('all obligations are indeterminate, warn and continue.')).toBe(true);
    expect(hasNegativePath('all obligations are indeterminate, skip this check.')).toBe(true);
    expect(hasNegativePath('all obligations are indeterminate, pass this requirement.')).toBe(true);
    expect(hasNegativePath('all obligations are indeterminate, fail closed.')).toBe(true);
    expect(hasNegativePath('all obligations are indeterminate and must halt.')).toBe(true);
  });

  it('dedupes defects with missing line locations using the nullish fallback key', () => {
    const deduped = dedupeByLineAndCategory([
      { category: 'dangling_reference', locations: [] },
      { category: 'dangling_reference', locations: [] },
      { category: 'unresolvable_reference', locations: [] },
    ]);

    expect(deduped).toEqual([
      { category: 'dangling_reference', locations: [] },
      { category: 'unresolvable_reference', locations: [] },
    ]);
  });
});

describe('bug fixes', () => {
  it('does not false-positive dangling references for IDs defined only in headings', () => {
    // Bug 1: collectDefinedIds used review_lines (headings filtered) so heading-defined
    // IDs were invisible, causing false-positive dangling references.
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        '## FR-1: Functional Requirement',
        '',
        'This requirement is satisfied by EC-5.',
        '',
        '## EC-5: Edge Case',
        '',
        'This edge case is handled.',
        '',
      ].join('\n'),
    });

    expect(report.defects.filter((d) => d.category === 'dangling_reference')).toEqual([]);
  });

  it('reports all always/never contradictions across multiple distinct quoted subjects', () => {
    // Bug 2: return defects inside the inner for-loop exited the entire detect()
    // on the first always/never match, silently dropping subsequent pairs.
    const report = reviewSpecification({
      spec_file: 'docs/spec.md',
      spec_markdown: [
        '# Spec',
        '',
        'The parser must always emit "structured".',
        'The parser must never emit "structured".',
        'The gate must always return "pass".',
        'The gate must never return "pass".',
        '',
      ].join('\n'),
    });

    const contradictions = report.defects.filter((d) => d.category === 'contradiction');
    expect(contradictions).toHaveLength(2);
    expect(contradictions.map((d) => d.severity).every((s) => s === 'major')).toBe(true);
  });
});
