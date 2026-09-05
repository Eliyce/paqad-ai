import { describe, expect, it } from 'vitest';

import { buildExpertAccounting } from '@/spec-pipeline/experts/accounting.js';
import type { ExpertNote, MergedExpertNotes } from '@/spec-pipeline/experts/types.js';

const dbNote: ExpertNote = {
  role: 'db-expert',
  findings: [{ target: 'invoices', claim: 'add an index on customer_id' }],
};
const secNote: ExpertNote = {
  role: 'security-auditor',
  findings: [{ target: 'auth', claim: 'rotate the token on privilege change' }],
};

describe('buildExpertAccounting', () => {
  it('records role, reason, tokens, and changed_spec per expert (AC-5/AC-7)', () => {
    const merged: MergedExpertNotes = {
      findings: [...dbNote.findings, ...secNote.findings],
      conflicts: [],
    };
    const result = buildExpertAccounting({
      needs: [
        { role: 'db-expert', reason: 'touches the invoices migration' },
        { role: 'security-auditor', reason: 'touches auth' },
      ],
      notes: [dbNote, secNote],
      tokens: { 'db-expert': 1200, 'security-auditor': 800 },
      merged,
    });
    expect(result.total_tokens).toBe(2000);
    expect(result.experts).toEqual([
      {
        role: 'db-expert',
        reason: 'touches the invoices migration',
        tokens: 1200,
        changed_spec: true,
      },
      { role: 'security-auditor', reason: 'touches auth', tokens: 800, changed_spec: true },
    ]);
  });

  it('marks changed_spec false for an expert whose findings did not survive the merge (§4.1)', () => {
    // db-expert's finding is NOT in the merged set ⇒ pure cost, changed nothing.
    const merged: MergedExpertNotes = { findings: [...secNote.findings], conflicts: [] };
    const result = buildExpertAccounting({
      needs: [
        { role: 'db-expert', reason: 'x' },
        { role: 'security-auditor', reason: 'y' },
      ],
      notes: [dbNote, secNote],
      tokens: { 'db-expert': 500, 'security-auditor': 700 },
      merged,
    });
    expect(result.experts[0]?.changed_spec).toBe(false);
    expect(result.experts[1]?.changed_spec).toBe(true);
  });

  it('defaults missing token actuals to 0', () => {
    const result = buildExpertAccounting({
      needs: [{ role: 'db-expert', reason: 'x' }],
      notes: [],
      tokens: {},
      merged: { findings: [], conflicts: [] },
    });
    expect(result.experts[0]?.tokens).toBe(0);
    expect(result.experts[0]?.changed_spec).toBe(false);
    expect(result.total_tokens).toBe(0);
  });

  it('carries upstream warnings through untouched', () => {
    const result = buildExpertAccounting({
      needs: [],
      notes: [],
      tokens: {},
      merged: { findings: [], conflicts: [] },
      warnings: ['ceiling exceeded'],
    });
    expect(result.warnings).toEqual(['ceiling exceeded']);
    expect(result.experts).toEqual([]);
  });
});
