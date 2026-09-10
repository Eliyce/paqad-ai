import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildExpertBriefs,
  expertBriefPath,
  lensPathForRole,
  writeExpertBriefs,
} from '@/spec-pipeline/experts/brief.js';
import type { GroundingArtifact, LabelArtifact } from '@/spec-pipeline/types.js';
import type { ExpertNeed } from '@/spec-pipeline/experts/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-brief-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

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
  it('writes one brief per needed expert, each with lens, request, budget and label', () => {
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
    expect(db.content).toContain('- invoice');
    expect(db.content).toContain('doc: docs/modules/billing/index.md');
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
    expect(briefs[0]!.content).toContain('Terms:\n- (none)');
    expect(briefs[0]!.content).toContain('References:\n- (none)');
  });

  it('trims the grounding to the granted budget, dropping the longest pointers first', () => {
    const bigGrounding: GroundingArtifact = {
      references: [{ kind: 'doc', ref: 'a-very-long-reference-path-that-costs-a-lot.md' }],
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
    // The longest pointer (the doc reference) is dropped; short terms survive.
    expect(brief.content).not.toContain('a-very-long-reference-path');
    expect(brief.content).toContain('- x');
  });

  it('writeExpertBriefs writes each brief to its scratch path and returns them', () => {
    const root = tempRoot();
    const { briefs } = buildExpertBriefs({
      needs: [{ role: 'db-expert', reason: 'r' }],
      request: 'r',
      grounding,
      label,
      ceiling: 60000,
    });
    const paths = writeExpertBriefs(root, 'change-x', briefs);
    expect(paths).toEqual([expertBriefPath('change-x', 'db-expert')]);
    expect(readFileSync(join(root, paths[0]!), 'utf8')).toContain('# Expert brief — db-expert');
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
