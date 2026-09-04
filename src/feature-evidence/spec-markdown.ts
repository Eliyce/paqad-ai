// Human-readable `specification.md` renderer (issue #512, Part A).
//
// A derived, read-only projection of a frozen `FeatureSpec`. It is the exact shape of the
// `report.html` precedent (#371): a PURE function that a thin writer persists beside
// `specification.json` on every freeze, so the bundle always carries a readable spec that
// can never drift from the canonical JSON and is never a second source of truth (the
// input-deletion contract of #402 stands — the input markdown is still deleted).
//
// Pure and deterministic by contract (INV-2): the same frozen spec renders byte-identical
// markdown. No filesystem or network I/O, and no clock — every timestamp comes from the
// spec's own frozen metadata, never `Date.now()` — so the projection is trivially testable
// for byte-stability and safe to regenerate on every freeze.

import type { FeatureSpec } from '@/core/types/feature-spec.js';

/** A criterion, rendered "Given …, when …, then …" or just its `then` when the rest is empty. */
function renderCriterionStatement(given: string, when: string, then: string): string {
  const g = given.trim();
  const w = when.trim();
  const t = then.trim();
  if (g.length === 0 && w.length === 0) {
    return t;
  }
  return `Given ${g}, when ${w}, then ${t}`;
}

/**
 * Render a frozen {@link FeatureSpec} to human-readable markdown. Pure and deterministic:
 * same spec in → byte-identical markdown out. Throws on an unfrozen spec — the projection
 * only ever renders a spec of record.
 */
export function renderSpecMarkdown(spec: FeatureSpec): string {
  if (spec.frozen === null) {
    throw new Error(
      'renderSpecMarkdown: refusing to render an unfrozen spec (spec.frozen is null)',
    );
  }

  const lines: string[] = [];
  lines.push(`# Specification: ${spec.spec_id}`);
  lines.push('');

  // Frozen block — the proof this is a spec of record.
  lines.push('## Frozen');
  lines.push('');
  lines.push(`- Signed off by: ${spec.frozen.signed_off_by}`);
  lines.push(`- Frozen at: ${spec.frozen.frozen_at}`);
  lines.push(`- Spec hash: ${spec.frozen.spec_hash}`);
  lines.push(`- Spec file: ${spec.spec_file}`);
  lines.push('');

  // Behaviour.
  lines.push('## Behaviour');
  lines.push('');
  if (spec.behaviour.length === 0) {
    lines.push('_None recorded._');
  } else {
    for (const item of spec.behaviour) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');

  // Acceptance criteria.
  lines.push('## Acceptance criteria');
  lines.push('');
  if (spec.acceptance_criteria.length === 0) {
    lines.push('_None recorded._');
  } else {
    for (const criterion of spec.acceptance_criteria) {
      const statement = renderCriterionStatement(criterion.given, criterion.when, criterion.then);
      lines.push(`- **${criterion.criterion_id}**: ${statement} (proof: ${criterion.proof_type})`);
    }
  }
  lines.push('');

  // Invariants.
  lines.push('## Invariants');
  lines.push('');
  if (spec.invariants.length === 0) {
    lines.push('_None recorded._');
  } else {
    for (const invariant of spec.invariants) {
      const mark = invariant.confirmed ? '✓' : '✗';
      lines.push(
        `- **${invariant.invariant_id}**: ${invariant.statement} _(source: ${invariant.source}, confirmed: ${mark})_`,
      );
    }
  }
  lines.push('');

  // Spec review — only when present (tolerate pre-#401 records).
  if (spec.spec_review !== undefined) {
    const review = spec.spec_review;
    lines.push('## Spec review');
    lines.push('');
    lines.push(`- Reviewed at: ${review.reviewed_at}`);
    lines.push(`- Open defects: ${review.defect_count}`);
    lines.push(
      `- By severity: critical ${review.by_severity.critical}, major ${review.by_severity.major}, minor ${review.by_severity.minor}`,
    );
    lines.push('');
  }

  // Non-goals — only when present (tolerate specs authored without the section).
  if (spec.non_goals !== undefined && spec.non_goals.length > 0) {
    lines.push('## Non-goals');
    lines.push('');
    for (const nonGoal of spec.non_goals) {
      lines.push(`- ${nonGoal}`);
    }
    lines.push('');
  }

  lines.push(
    '_This file is a generated, read-only projection of `specification.json`. Do not hand-edit; it is regenerated on every `paqad-ai spec freeze`._',
  );
  lines.push('');

  return lines.join('\n');
}
