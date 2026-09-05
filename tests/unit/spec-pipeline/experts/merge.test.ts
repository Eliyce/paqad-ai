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
      { role: 'db-expert', findings: [{ target: 'orders', claim: 'denormalise for read speed' }] },
      { role: 'data-modeler', findings: [{ target: 'orders', claim: 'keep normalised' }] },
    ];
    const result = mergeExpertNotes(notes);
    // Neither claim silently wins.
    expect(result.findings).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({
      target: 'orders',
      roles: ['db-expert', 'data-modeler'],
      claims: ['denormalise for read speed', 'keep normalised'],
    });
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
});
