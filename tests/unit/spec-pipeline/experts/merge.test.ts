import { describe, expect, it } from 'vitest';

import { mergeExpertNotes } from '@/spec-pipeline/experts/merge.js';
import type { ExpertNote } from '@/spec-pipeline/experts/types.js';

describe('mergeExpertNotes', () => {
  it('flows non-overlapping findings through as the merged set', () => {
    const notes: ExpertNote[] = [
      { role: 'db-expert', findings: [{ target: 'invoices', claim: 'index customer_id' }] },
      { role: 'security-auditor', findings: [{ target: 'auth', claim: 'rotate tokens' }] },
    ];
    const result = mergeExpertNotes(notes);
    expect(result.conflicts).toEqual([]);
    expect(result.findings).toHaveLength(2);
  });

  it('surfaces contradictory claims on the same target as a conflict, choosing nothing (AC-9)', () => {
    const notes: ExpertNote[] = [
      {
        role: 'db-expert',
        findings: [{ id: 'EX-db-expert-1', target: 'orders', claim: 'denormalise for read speed' }],
      },
      {
        role: 'data-modeler',
        findings: [{ id: 'EX-data-modeler-1', target: 'orders', claim: 'keep normalised' }],
      },
    ];
    const result = mergeExpertNotes(notes);
    expect(result.findings).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({
      target: 'orders',
      roles: ['db-expert', 'data-modeler'],
      claims: ['denormalise for read speed', 'keep normalised'],
      finding_ids: ['EX-db-expert-1', 'EX-data-modeler-1'],
    });
  });

  it('carries an empty finding id positionally for a finding recorded without one', () => {
    const notes: ExpertNote[] = [
      { role: 'db-expert', findings: [{ target: 'orders', claim: 'denormalise' }] },
      { role: 'data-modeler', findings: [{ target: 'orders', claim: 'normalise' }] },
    ];
    const result = mergeExpertNotes(notes);
    expect(result.conflicts[0]?.finding_ids).toEqual(['', '']);
  });

  it('treats identical claims on a target (even across experts) as agreement, not conflict', () => {
    const notes: ExpertNote[] = [
      { role: 'db-expert', findings: [{ target: 'orders', claim: 'Add an index' }] },
      { role: 'performance-analyst', findings: [{ target: 'orders', claim: 'add an  index' }] },
    ];
    const result = mergeExpertNotes(notes);
    expect(result.conflicts).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.claim).toBe('Add an index');
  });

  it('is empty for no notes', () => {
    expect(mergeExpertNotes([])).toEqual({ findings: [], conflicts: [] });
  });

  it('preserves the original (untrimmed) target and claim strings in the output', () => {
    const notes: ExpertNote[] = [
      { role: 'db-expert', findings: [{ target: ' Orders ', claim: 'denormalise' }] },
      { role: 'data-modeler', findings: [{ target: 'orders', claim: 'normalise' }] },
    ];
    const result = mergeExpertNotes(notes);
    expect(result.conflicts[0]?.target).toBe(' Orders ');
  });

  it('AC-1: collapses two same-role findings on one target into one merged finding with no conflict', () => {
    const notes: ExpertNote[] = [
      {
        role: 'security-auditor',
        findings: [
          { id: 'EX-security-auditor-1', target: 'Auth Token', claim: 'rotate tokens' },
          {
            id: 'EX-security-auditor-2',
            target: 'auth token',
            claim: 'rotate tokens every hour',
          },
        ],
      },
    ];
    const result = mergeExpertNotes(notes);
    expect(result.conflicts).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      id: 'EX-security-auditor-2',
      claim: 'rotate tokens every hour',
      merged_from: ['EX-security-auditor-1', 'EX-security-auditor-2'],
    });
  });

  it('AC-1: different roles with different claims on one target still conflict', () => {
    const notes: ExpertNote[] = [
      {
        role: 'security-auditor',
        findings: [
          { id: 'EX-security-auditor-1', target: 'auth', claim: 'rotate tokens' },
          { id: 'EX-security-auditor-2', target: 'auth', claim: 'rotate tokens hourly' },
        ],
      },
      {
        role: 'performance-analyst',
        findings: [{ id: 'EX-performance-analyst-1', target: 'auth', claim: 'cache tokens' }],
      },
    ];
    const result = mergeExpertNotes(notes);
    expect(result.findings).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({
      target: 'auth',
      roles: ['security-auditor', 'performance-analyst'],
      claims: ['rotate tokens hourly', 'cache tokens'],
      finding_ids: ['EX-security-auditor-2', 'EX-performance-analyst-1'],
    });
  });

  it('AC-2: three same-role findings keep the longest claim, ties go to the first in note order', () => {
    const findings = [
      { id: 'EX-db-expert-1', target: 'orders', claim: 'index a' },
      { id: 'EX-db-expert-2', target: 'orders', claim: 'index bb' },
      { id: 'EX-db-expert-3', target: 'orders', claim: 'index cc' },
    ];
    const forward = mergeExpertNotes([{ role: 'db-expert', findings }]);
    expect(forward.conflicts).toEqual([]);
    expect(forward.findings).toHaveLength(1);
    expect(forward.findings[0]?.claim).toBe('index bb');
    expect(forward.findings[0]?.merged_from).toEqual([
      'EX-db-expert-1',
      'EX-db-expert-2',
      'EX-db-expert-3',
    ]);

    const reversed = mergeExpertNotes([{ role: 'db-expert', findings: [...findings].reverse() }]);
    expect(reversed.findings).toHaveLength(1);
    expect(reversed.findings[0]?.claim).toBe('index cc');
    expect([...(reversed.findings[0]?.merged_from ?? [])].sort()).toEqual([
      'EX-db-expert-1',
      'EX-db-expert-2',
      'EX-db-expert-3',
    ]);
  });
});
