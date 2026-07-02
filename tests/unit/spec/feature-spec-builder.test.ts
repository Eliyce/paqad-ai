import { describe, expect, it } from 'vitest';

import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';
import type { SpecReviewReport } from '@/compliance/types.js';

const SPEC_MARKDOWN = `# Spec: Export report

## Summary
Lets an admin export a report.

## Functional Requirements
FR-1: The system must generate a CSV when the admin clicks export.
FR-2: The system must reject exports larger than 10MB.

## Non-Functional Requirements
NFR-1: Export completes within 5 seconds.

## Acceptance Criteria
AC-1: Given an admin, when they click export, then a CSV downloads.
AC-2: Given a report over 10MB, when export is requested, then a 413 is returned (proof: manual).

## Invariants
- INV-1: A non-admin can never trigger an export.

## Open Questions
Q1: Should exports be rate limited?
`;

describe('buildFeatureSpec', () => {
  it('derives behaviour from functional and non-functional obligations', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-102',
      spec_file: '.paqad/specs/S-102-export.md',
      spec_markdown: SPEC_MARKDOWN,
      extracted_at: '2026-06-07T00:00:00Z',
    });

    expect(spec.behaviour).toEqual([
      'FR-1: The system must generate a CSV when the admin clicks export.',
      'FR-2: The system must reject exports larger than 10MB.',
      'NFR-1: Export completes within 5 seconds.',
    ]);
  });

  it('authors acceptance criteria in the VerificationCriterion shape with given/when/then', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-102',
      spec_file: '.paqad/specs/S-102-export.md',
      spec_markdown: SPEC_MARKDOWN,
    });

    expect(spec.acceptance_criteria).toHaveLength(2);
    const [first, second] = spec.acceptance_criteria;
    expect(first).toMatchObject({
      criterion_id: 'AC-1',
      given: 'an admin',
      when: 'they click export',
      then: 'a CSV downloads',
      proof_type: 'automated',
      status: 'uncovered',
      source: 'planned',
      linked_requirement_ids: [],
    });
    expect(second!.criterion_id).toBe('AC-2');
    expect(second!.proof_type).toBe('manual');
  });

  it('preserves an AC-TRACK-<slug> analytics tracking id (issue #279)', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-279',
      spec_file: '.paqad/specs/S-279.md',
      spec_markdown: `## Acceptance Criteria\nAC-TRACK-song-played: Given a listener, when a song plays, then a song_played event is tracked.\n`,
    });

    expect(spec.acceptance_criteria).toHaveLength(1);
    expect(spec.acceptance_criteria[0]).toMatchObject({
      criterion_id: 'AC-TRACK-song-played',
      then: 'a song_played event is tracked',
      proof_type: 'automated',
    });
  });

  it('collects authored invariants and stamps them unconfirmed', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-102',
      spec_file: '.paqad/specs/S-102-export.md',
      spec_markdown: SPEC_MARKDOWN,
    });

    expect(spec.invariants).toEqual([
      {
        invariant_id: 'INV-1',
        statement: 'A non-admin can never trigger an export.',
        source: 'authored',
        confirmed: false,
      },
    ]);
  });

  it('extracts open questions', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-102',
      spec_file: '.paqad/specs/S-102-export.md',
      spec_markdown: SPEC_MARKDOWN,
    });

    expect(spec.open_questions).toEqual(['Q1: Should exports be rate limited?']);
    expect(spec.frozen).toBeNull();
    expect(spec.spec_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('appends rule-sourced suggested invariants and de-duplicates by statement', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-102',
      spec_file: '.paqad/specs/S-102-export.md',
      spec_markdown: SPEC_MARKDOWN,
      suggested_invariants: [
        {
          statement: 'Audit log entries are append-only.',
          source: 'compiled-rule',
          rule_id: 'R-12',
        },
        { statement: 'A non-admin can never trigger an export.', source: 'module-rule' },
        { statement: '   ', source: 'module-rule' },
      ],
    });

    expect(spec.invariants).toHaveLength(2);
    expect(spec.invariants[1]).toEqual({
      invariant_id: 'INV-2',
      statement: 'Audit log entries are append-only.',
      source: 'compiled-rule',
      rule_id: 'R-12',
      confirmed: false,
    });
  });

  it('falls back to a then-only criterion when given/when/then is absent', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-9',
      spec_file: '.paqad/specs/S-9.md',
      spec_markdown: `## Acceptance Criteria\nAC-1: The export button is visible.\n`,
    });

    expect(spec.acceptance_criteria[0]).toMatchObject({
      criterion_id: 'AC-1',
      given: '',
      when: '',
      then: 'The export button is visible.',
    });
  });

  it('assigns sequential AC ids to numbered-list acceptance criteria', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-7',
      spec_file: '.paqad/specs/S-7.md',
      spec_markdown: `## Acceptance Criteria\n1. Given a user, when they act, then it works.\n2. Given an error, when it occurs, then it is logged.\n`,
    });

    expect(spec.acceptance_criteria.map((criterion) => criterion.criterion_id)).toEqual([
      'AC-1',
      'AC-2',
    ]);
    expect(spec.acceptance_criteria.map((criterion) => criterion.then).sort()).toEqual([
      'it is logged',
      'it works',
    ]);
  });

  it('attaches spec-review defects through the obligation extractor', () => {
    const review: SpecReviewReport = {
      metadata: {
        spec_file: '.paqad/specs/S-102-export.md',
        spec_hash: 'abc',
        reviewed_at: '2026-06-07T00:00:00Z',
        schema_version: 1,
        defect_count: 0,
      },
      defects: [],
      pattern_advisories: [],
    };

    const spec = buildFeatureSpec({
      spec_id: 'S-102',
      spec_file: '.paqad/specs/S-102-export.md',
      spec_markdown: SPEC_MARKDOWN,
      spec_review: review,
    });

    expect(spec.acceptance_criteria.length).toBeGreaterThan(0);
  });

  it('returns empty sections for a spec with no recognizable structure', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-0',
      spec_file: '.paqad/specs/S-0.md',
      spec_markdown: '# Empty\n\nJust prose, nothing structured.\n',
    });

    expect(spec.behaviour).toEqual([]);
    expect(spec.acceptance_criteria).toEqual([]);
    expect(spec.invariants).toEqual([]);
    expect(spec.open_questions).toEqual([]);
  });
});
