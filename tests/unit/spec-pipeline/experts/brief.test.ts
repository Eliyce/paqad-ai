import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@/compliance/markdown.js';
import {
  buildExpertBriefs,
  lensPathForRole,
  renderExpertBrief,
  rosterEntryFor,
} from '@/spec-pipeline/experts/brief.js';
import type { GroundingArtifact, LabelArtifact } from '@/spec-pipeline/types.js';
import type { ExpertNeed } from '@/spec-pipeline/experts/types.js';

const grounding: GroundingArtifact = {
  references: [{ kind: 'doc', ref: 'docs/modules/billing/index.md' }],
  terms: ['invoice', 'line_item'],
  sparse: false,
  path: 'docs-fallback',
};
const label: LabelArtifact = {
  label: 'okay',
  signals: [{ kind: 'unresolved-vague-word', span: 'fast' }],
  question_budget: 3,
};

describe('buildExpertBriefs', () => {
  it('builds one brief per needed expert, each with lens, request, budget and label', () => {
    const needs: ExpertNeed[] = [
      { role: 'db-expert', reason: 'touches the invoices migration' },
      { role: 'security-auditor', reason: 'exports customer data' },
    ];
    const { briefs, warnings } = buildExpertBriefs({
      needs,
      request: 'Let customers download their invoices as CSV',
      ticketAcceptanceCriteria: ['A signed-in customer can download a CSV of their invoices'],
      grounding,
      label,
      ceiling: 60000,
    });
    expect(warnings).toEqual([]);
    expect(briefs.map((b) => b.role)).toEqual(['db-expert', 'security-auditor']);
    const db = briefs[0]!;
    expect(db.truncated).toBe(false);
    expect(db.granted).toBe(6000);
    expect(db.content).toContain(`\`${lensPathForRole('db-expert')}\``);
    expect(db.content).toContain('Let customers download their invoices as CSV');
    expect(db.content).toContain('## Ticket acceptance criteria');
    // Issue #581 — the grounding terms are not persisted, so the brief no longer lists them.
    expect(db.content).not.toContain('Terms:');
    expect(db.content).not.toContain('- invoice');
    expect(db.content).toContain('doc: docs/modules/billing/index.md');
    expect(db.hash).toBe(sha256Hex(db.content));
    expect(db.content).toContain('Label: okay');
    expect(db.content).toContain('Granted budget: 6000 tokens');
  });

  it('omits the ticket-AC section when none are supplied and shows (none) for empty grounding', () => {
    const { briefs } = buildExpertBriefs({
      needs: [{ role: 'qa-engineer', reason: 'observable behaviour' }],
      request: 'do a thing',
      grounding: { references: [], terms: [], sparse: true, path: 'rag' },
      label: { label: 'clear', signals: [], question_budget: 0 },
      ceiling: 60000,
    });
    expect(briefs[0]!.content).not.toContain('## Ticket acceptance criteria');
    expect(briefs[0]!.content).toContain('References:\n- (none)');
  });

  it('trims the grounding to the granted budget, dropping the longest pointers first', () => {
    const bigGrounding: GroundingArtifact = {
      references: [
        { kind: 'doc', ref: 'a-very-long-reference-path-that-costs-a-lot.md' },
        { kind: 'rule', ref: 'x' },
      ],
      terms: ['x', 'yy'],
      sparse: false,
      path: 'docs-fallback',
    };
    // A tiny ceiling clamps the single expert to a granted slice of a few tokens.
    const { briefs } = buildExpertBriefs({
      needs: [{ role: 'db-expert', reason: 'r' }],
      request: 'r',
      grounding: bigGrounding,
      label,
      ceiling: 2,
    });
    const brief = briefs[0]!;
    expect(brief.granted).toBe(2);
    expect(brief.clamped).toBe(true);
    expect(brief.truncated).toBe(true);
    // The longest pointer (the doc reference) is dropped; the short rule reference survives.
    expect(brief.content).not.toContain('a-very-long-reference-path');
    expect(brief.content).toContain('- rule: x');
  });

  it('renders the same text and hash from the roster entry alone (issue #581, AC-8)', () => {
    const need: ExpertNeed = { role: 'db-expert', reason: 'touches the invoices migration' };
    const input = { needs: [need], request: 'Export invoices', grounding, label, ceiling: 60000 };
    const built = buildExpertBriefs(input).briefs[0]!;
    const entry = rosterEntryFor(need, built);
    expect(entry).toEqual({
      role: 'db-expert',
      reason: 'touches the invoices migration',
      lens: lensPathForRole('db-expert'),
      budget_tokens: built.granted,
      grounding_truncated: false,
      brief_hash: built.hash,
      tokens_used: null,
    });
    // A rebuild needs only the recorded request, grounding references, label and roster entry.
    const rebuilt = renderExpertBrief({
      need: { role: entry.role, reason: entry.reason },
      request: 'Export invoices',
      grounding: { references: grounding.references },
      label,
      granted: entry.budget_tokens,
    });
    expect(rebuilt.content).toBe(built.content);
    expect(rebuilt.hash).toBe(entry.brief_hash);
  });

  it('surfaces the ceiling warning without dropping an expert (INV-5)', () => {
    const { briefs, warnings } = buildExpertBriefs({
      needs: [
        { role: 'db-expert', reason: 'a' },
        { role: 'security-auditor', reason: 'b' },
      ],
      request: 'r',
      grounding,
      label,
      ceiling: 100,
    });
    expect(briefs).toHaveLength(2);
    expect(warnings.join(' ')).toMatch(/ceiling/);
  });
});
