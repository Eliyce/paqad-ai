// The S4 parser-parity check (issue #512, FR-6.6 / EC-11).
//
// The crafting step's format check applies the SAME shape rules as the freeze parser, so a
// spec that passes S4 can never fail the freeze on shape. It does this by running the REAL
// freeze parser (`buildFeatureSpec` → `extractObligationIndex`) rather than a parallel one,
// then asserting the shape invariants on the result. A shared fixture corpus (below) is run
// against BOTH this check and the freeze parser in CI, so a freeze-parser change that breaks
// parity fails the build (FR-10.2).

import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';

/** The section headings the freeze parser recognizes (case-insensitive, level-agnostic). */
export const RECOGNIZED_HEADINGS = [
  'summary',
  'functional requirements',
  'non-functional requirements',
  'acceptance criteria',
  'edge cases',
  'invariants',
  'non-goals',
  'open questions',
] as const;

export interface SpecShapeResult {
  ok: boolean;
  problems: string[];
}

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Check a crafted spec markdown against the freeze parser's shape rules. Deterministic and
 * model-free. Returns the problems found (empty ⇒ the freeze will accept the shape).
 */
export function checkSpecShape(markdown: string): SpecShapeResult {
  const problems: string[] = [];

  // Unknown-heading guard (EC-11): every `##`+ heading must be in the recognized set.
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{2,6})\s+(.*\S)\s*$/.exec(line);
    if (!heading) continue;
    const text = normalizeHeading(heading[2]!);
    if (!(RECOGNIZED_HEADINGS as readonly string[]).includes(text)) {
      problems.push(
        `unrecognized heading "${heading[2]!.trim()}" — recognized: ${RECOGNIZED_HEADINGS.join(', ')}`,
      );
    }
  }

  // Dotted AC ids are mangled by the flat-only freeze parser (#512/C4) — reject at S4.
  if (/(^|\s)AC-\d+\.\d+/m.test(markdown)) {
    problems.push('dotted AC-N.N criterion id — the freeze parser reads flat AC-N only');
  }

  // Run the REAL parser and assert the shape invariants on its output.
  const spec = buildFeatureSpec({
    spec_id: 'S-shape-check',
    spec_file: '.paqad/_specs/shape-check.md',
    spec_markdown: markdown,
  });

  if (spec.behaviour.length === 0) {
    problems.push('no behaviour — needs a ## Functional requirements section (FR-n / NFR-n)');
  }
  if (spec.acceptance_criteria.length === 0) {
    problems.push('no acceptance criteria — needs a ## Acceptance criteria section (AC-n)');
  }
  for (const criterion of spec.acceptance_criteria) {
    if (!criterion.proof_type) {
      problems.push(`criterion ${criterion.criterion_id} has no proof type (add "(proof: …)")`);
    }
    if (criterion.then.trim().length === 0) {
      problems.push(`criterion ${criterion.criterion_id} has no observable "then" clause`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * The shared parity corpus: specs that MUST pass both {@link checkSpecShape} and the freeze
 * parser. A change to either the freeze parser or this check that breaks one but not the
 * other fails CI (FR-10.2), so the two can never drift apart.
 */
export const PARITY_CORPUS: readonly { name: string; markdown: string }[] = [
  {
    name: 'minimal flat spec',
    markdown: [
      '## Functional requirements',
      'FR-1: the export excludes hidden columns.',
      '## Acceptance criteria',
      '- AC-1: Given an admin, when they export, then hidden columns are omitted (proof: automated).',
      '## Invariants',
      '- INV-1: an export never includes a hidden column.',
    ].join('\n'),
  },
  {
    name: 'multi-criterion with non-goals and NFR',
    markdown: [
      '## Summary',
      'Cleaner report export.',
      '## Functional requirements',
      'FR-1: the export excludes hidden columns.',
      '## Non-functional requirements',
      'NFR-1: an export of 10k rows completes within 5 seconds.',
      '## Acceptance criteria',
      '- AC-1: Given an admin, when they export, then hidden columns are omitted (proof: automated).',
      '- AC-2: Given a large report, when they export, then it completes under 5s (proof: manual).',
      '## Non-goals',
      '- does not change the import path',
      '## Invariants',
      '- INV-1: an export never includes a hidden column.',
    ].join('\n'),
  },
  {
    // Issue #519 (B.5.2): a crafted spec that reused `edge-case-detection` in S4 — an empty /
    // permission negative-path AC folded in, and a deliberately excluded edge behaviour under
    // `## Non-goals`. It must pass BOTH the S4 shape check and the freeze parser (its non-goals
    // parse into FeatureSpec.non_goals, FR-6.4).
    name: 'negative-path AC with edge-case-detection non-goals',
    markdown: [
      '## Summary',
      'Bulk archive of selected records.',
      '## Functional requirements',
      'FR-1: an editor can archive the records they selected.',
      '## Acceptance criteria',
      '- AC-1: Given selected records, when an editor archives them, then each is marked archived (proof: automated).',
      '- AC-2: Given an empty selection, when the editor triggers archive, then the action is rejected with a validation message and nothing is archived (proof: automated).',
      '- AC-3: Given a viewer without archive permission, when they trigger archive, then the request is denied and no record changes (proof: automated).',
      '## Non-goals',
      '- does not archive records the editor did not select',
      '- does not add an undo path for an archive',
      '## Invariants',
      '- INV-1: an archive never touches a record outside the current selection.',
    ].join('\n'),
  },
];
