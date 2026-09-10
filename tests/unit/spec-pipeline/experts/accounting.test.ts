import { describe, expect, it } from 'vitest';

import { buildExpertAccounting } from '@/spec-pipeline/experts/accounting.js';
import type { ExpertNote } from '@/spec-pipeline/experts/types.js';

const dbNote: ExpertNote = {
  role: 'db-expert',
  findings: [{ id: 'EX-db-expert-1', target: 'invoices', claim: 'add an index on customer_id' }],
};
const secNote: ExpertNote = {
  role: 'security-auditor',
  findings: [
    { id: 'EX-security-auditor-1', target: 'auth', claim: 'rotate the token on privilege change' },
  ],
};

describe('buildExpertAccounting', () => {
  it('records role, reason, tokens, and trace-based changed_spec per expert (AC-5/AC-7)', () => {
    // Both finding ids appear as trace sources ⇒ both experts changed the spec (FR-11.2).
    const result = buildExpertAccounting({
      needs: [
        { role: 'db-expert', reason: 'touches the invoices migration' },
        { role: 'security-auditor', reason: 'touches auth' },
      ],
      notes: [dbNote, secNote],
      tokens: { 'db-expert': 1200, 'security-auditor': 800 },
      tracedFindingIds: new Set(['EX-db-expert-1', 'EX-security-auditor-1']),
    });
    expect(result.total_tokens).toBe(2000);
    expect(result.experts).toEqual([
      { role: 'db-expert', reason: 'touches the invoices migration', tokens: 1200, changed_spec: true },
      { role: 'security-auditor', reason: 'touches auth', tokens: 800, changed_spec: true },
    ]);
  });

  it('marks changed_spec false for an expert whose finding never traced to a spec line (FR-11.2)', () => {
    // db-expert's finding id is NOT a trace source ⇒ pure cost, changed nothing.
    const result = buildExpertAccounting({
      needs: [
        { role: 'db-expert', reason: 'x' },
        { role: 'security-auditor', reason: 'y' },
      ],
      notes: [dbNote, secNote],
      tokens: { 'db-expert': 500, 'security-auditor': 700 },
      tracedFindingIds: new Set(['EX-security-auditor-1']),
    });
    expect(result.experts[0]?.changed_spec).toBe(false);
    expect(result.experts[1]?.changed_spec).toBe(true);
  });

  it('defaults missing token actuals to 0 and changed_spec to false with no trace', () => {
    const result = buildExpertAccounting({
      needs: [{ role: 'db-expert', reason: 'x' }],
      notes: [],
      tokens: {},
      tracedFindingIds: new Set(),
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
      tracedFindingIds: new Set(),
      warnings: ['ceiling exceeded'],
    });
    expect(result.warnings).toEqual(['ceiling exceeded']);
    expect(result.experts).toEqual([]);
  });
});
