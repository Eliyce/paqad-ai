/**
 * Tests for the enhanced / generalised spec-review detectors.
 * Covers new code paths added in the Gap-1 improvements.
 */
import { describe, expect, it } from 'vitest';

import { formulaDetector } from '@/compliance/spec-review-detectors/formula-detector.js';
import { goalConflictDetector } from '@/compliance/spec-review-detectors/goal-conflict-detector.js';
import type { ReviewContext } from '@/compliance/spec-review-detectors/types.js';

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

// ── formula-detector ────────────────────────────────────────────────────────

describe('formulaDetector', () => {
  it('detects the canonical covered / (total - indeterminate) pattern', () => {
    const defects = formulaDetector.detect(
      makeContext([
        'ratio = covered / (total - indeterminate)',
        'All obligations may be indeterminate.',
      ]),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]!.category).toBe('formula_inconsistency');
    expect(defects[0]!.severity).toBe('critical');
    expect(defects[0]!.locations).toHaveLength(2);
  });

  it('detects a generic division-by-zero risk from a named denominator', () => {
    const defects = formulaDetector.detect(
      makeContext([
        'The score is calculated as: points / (eligible)',
        'All eligible entries could be empty.',
      ]),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]!.category).toBe('formula_inconsistency');
    expect(defects[0]!.description).toMatch(/eligible/);
  });

  it('detects a generic division-by-zero risk for unparenthesized division', () => {
    const defects = formulaDetector.detect(
      makeContext(['The score is points / eligible', 'All eligible entries could be empty.']),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]!.category).toBe('formula_inconsistency');
    expect(defects[0]!.description).toMatch(/eligible/);
  });

  it('deduplicates when the canonical and generic patterns fire on the same line pair', () => {
    // Both the specific pattern and generic pattern match the same two lines.
    const defects = formulaDetector.detect(
      makeContext([
        'ratio = covered / (total - indeterminate)',
        'All total obligations may be indeterminate.',
      ]),
    );
    // Should deduplicate to one defect (same line pair)
    expect(defects).toHaveLength(1);
  });

  it('does not flag a division when no zero-case is mentioned', () => {
    const defects = formulaDetector.detect(
      makeContext(['The ratio is covered / (total - indeterminate).']),
    );
    expect(defects).toEqual([]);
  });

  it('does not flag divisions in URLs or file paths', () => {
    const defects = formulaDetector.detect(
      makeContext([
        'See https://example.com/api/v1/ratio for the formula.',
        'All entries could be empty.',
      ]),
    );
    expect(defects).toEqual([]);
  });

  it('skips trivially safe denominator keywords like "url"', () => {
    const defects = formulaDetector.detect(
      makeContext(['score = covered / (url)', 'All url values could be zero.']),
    );
    expect(defects).toEqual([]);
  });

  it('does not flag when the zero-case is on the same line as the division', () => {
    // Same line — should not pair with itself
    const defects = formulaDetector.detect(
      makeContext(['The ratio is covered / (eligible) when all eligible can be empty.']),
    );
    expect(defects).toEqual([]);
  });

  it('does not flag a division whose denominator is only 2 characters (filtered)', () => {
    const defects = formulaDetector.detect(
      makeContext(['result = x / (ab)', 'All ab could be empty.']),
    );
    expect(defects).toEqual([]);
  });

  it('returns an empty array for a spec with no formulas', () => {
    const defects = formulaDetector.detect(makeContext(['This spec has no formulas.']));
    expect(defects).toEqual([]);
  });
});

// ── goal-conflict-detector ───────────────────────────────────────────────────

describe('goalConflictDetector', () => {
  it('detects the canonical lossless vs ignore-table conflict', () => {
    const defects = goalConflictDetector.detect(
      makeContext(['Extraction must be lossless.', 'Non-matching tables must be ignored.']),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]!.category).toBe('goal_conflict');
    expect(defects[0]!.severity).toBe('major');
  });

  it('detects a must-preserve-all vs exclude-items conflict', () => {
    const defects = goalConflictDetector.detect(
      makeContext([
        'Nothing should be lost during the migration.',
        'Records that fail validation must be excluded from the output.',
      ]),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]!.category).toBe('goal_conflict');
    expect(defects[0]!.description).toMatch(/completeness/i);
  });

  it('detects a must-succeed-for-all vs partial conflict', () => {
    const defects = goalConflictDetector.detect(
      makeContext([
        'All obligations must be processed before the gate runs.',
        'Processing may fail for some obligations.',
      ]),
    );
    expect(defects).toHaveLength(1);
    expect(defects[0]!.category).toBe('goal_conflict');
    expect(defects[0]!.description).toMatch(/all-or-nothing/i);
  });

  it('reports multiple conflicts when more than one rule fires', () => {
    const defects = goalConflictDetector.detect(
      makeContext([
        'Extraction must be lossless.',
        'Non-matching tables must be ignored.',
        'Nothing should be lost.',
        'Records that fail validation must be excluded from the output.',
      ]),
    );
    // Both rule 1 and rule 2 fire independently
    expect(defects.length).toBeGreaterThanOrEqual(2);
    expect(defects.every((d) => d.category === 'goal_conflict')).toBe(true);
  });

  it('does not flag when only one side of a conflict is present', () => {
    const defects = goalConflictDetector.detect(makeContext(['Extraction must be lossless.']));
    expect(defects).toEqual([]);
  });

  it('returns an empty array for a spec with no conflicts', () => {
    const defects = goalConflictDetector.detect(makeContext(['The system shall log all events.']));
    expect(defects).toEqual([]);
  });
});
