import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isSynthesisShaped,
  readExpertMerge,
  readExpertSynthesis,
  validateExpertSynthesis,
  writeExpertMerge,
  writeExpertSynthesis,
  type ExpertSynthesis,
} from '@/spec-pipeline/experts/synthesis.js';
import type { MergedExpertNotes } from '@/spec-pipeline/experts/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-synth-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const merged: MergedExpertNotes = {
  findings: [
    { id: 'EX-db-expert-1', target: 'invoices', claim: 'index it', kind: 'requirement', severity: 'should' },
  ],
  conflicts: [
    {
      target: 'orders',
      roles: ['db-expert', 'data-modeler'],
      claims: ['denormalise for reads', 'keep normalised'],
      finding_ids: ['EX-db-expert-2', 'EX-data-modeler-1'],
    },
  ],
};

function validSynthesis(): ExpertSynthesis {
  return {
    verdict: 'ready',
    accepted: ['EX-db-expert-1'],
    declined: [],
    conflicts: [{ target: 'orders', recommendation: 'denormalise for reads', rationale: 'reads dominate' }],
    gaps: [],
    questions: [],
    tokens: 0,
  };
}

describe('validateExpertSynthesis', () => {
  it('accepts a well-formed synthesis that covers every finding and resolves each conflict', () => {
    const result = validateExpertSynthesis(validSynthesis(), merged);
    expect(result.ok).toBe(true);
    expect(result.artifact?.accepted).toEqual(['EX-db-expert-1']);
    expect(result.artifact?.conflicts[0]?.recommendation).toBe('denormalise for reads');
  });

  it('accepts a JSON string as well as an object', () => {
    expect(validateExpertSynthesis(JSON.stringify(validSynthesis()), merged).ok).toBe(true);
  });

  it('rejects a bad verdict', () => {
    const bad = { ...validSynthesis(), verdict: 'maybe' };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/verdict/);
  });

  it('rejects an accepted id the merge does not know (the chief may not add findings, INV-7)', () => {
    const bad = { ...validSynthesis(), accepted: ['EX-db-expert-1', 'EX-invented-9'] };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/may not add findings/);
  });

  it('rejects a declined id the merge does not know', () => {
    const bad = { ...validSynthesis(), accepted: [], declined: [{ id: 'EX-nope-1', reason: 'x' }] };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/may not add findings/);
  });

  it('rejects a declined entry with an empty reason', () => {
    const bad = { ...validSynthesis(), accepted: [], declined: [{ id: 'EX-db-expert-1', reason: '' }] };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/non-empty reason/);
  });

  it('rejects a merged finding that is neither accepted nor declined', () => {
    const bad = { ...validSynthesis(), accepted: [], declined: [] };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/neither accepted nor declined/);
  });

  it('rejects a finding accepted and declined at once', () => {
    const bad = { ...validSynthesis(), declined: [{ id: 'EX-db-expert-1', reason: 'x' }] };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/appears twice/);
  });

  it('rejects a conflict count that does not match the merge', () => {
    const bad = { ...validSynthesis(), conflicts: [] };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/resolve each exactly once|conflict rows/);
  });

  it('rejects a recommendation that is not one of the conflicting claims', () => {
    const bad = {
      ...validSynthesis(),
      conflicts: [{ target: 'orders', recommendation: 'do something else', rationale: 'r' }],
    };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/one of the conflicting claims/);
  });

  it('rejects a conflict target that is not a merge conflict', () => {
    const bad = {
      ...validSynthesis(),
      conflicts: [{ target: 'nope', recommendation: 'denormalise for reads', rationale: 'r' }],
    };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/not a merge conflict/);
  });

  it('rejects a conflict rationale that is empty', () => {
    const bad = {
      ...validSynthesis(),
      conflicts: [{ target: 'orders', recommendation: 'denormalise for reads', rationale: '' }],
    };
    expect(validateExpertSynthesis(bad, merged).error).toMatch(/non-empty rationale/);
  });

  it('rejects a non-object and non-JSON input', () => {
    expect(validateExpertSynthesis('{not json', merged).error).toMatch(/not valid JSON/);
    expect(validateExpertSynthesis(42, merged).error).toMatch(/must be an object/);
  });

  it('validates gap and top-level questions with the plain-language check when sources are given', () => {
    const withJargonGap = {
      ...validSynthesis(),
      gaps: [
        {
          area: 'currency',
          why_it_matters: 'non-default currency invoices',
          question: {
            business_text: 'idempotency key handling for the mutation',
            why_it_matters: 'matters',
            options: ['a', 'b'],
            grounded_in: null,
          },
        },
      ],
    };
    const result = validateExpertSynthesis(withJargonGap, merged, { terms: [], prompt: 'plain words' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plain language|flagged/);
  });

  it('accepts a needs-answers verdict with no conflicts when the merge has none', () => {
    const noConflicts: MergedExpertNotes = { findings: merged.findings, conflicts: [] };
    const result = validateExpertSynthesis(
      { verdict: 'needs-answers', accepted: ['EX-db-expert-1'], declined: [], gaps: [], questions: [], tokens: 5 },
      noConflicts,
    );
    expect(result.ok).toBe(true);
    expect(result.artifact?.conflicts).toEqual([]);
  });
});

describe('synthesis scratch io', () => {
  it('writes and reads the merge and synthesis, and reads null when absent', () => {
    const root = tempRoot();
    expect(readExpertMerge(root, 'c1')).toBeNull();
    expect(readExpertSynthesis(root, 'c1')).toBeNull();
    writeExpertMerge(root, 'c1', merged);
    writeExpertSynthesis(root, 'c1', validSynthesis());
    expect(readExpertMerge(root, 'c1')?.conflicts).toHaveLength(1);
    expect(readExpertSynthesis(root, 'c1')?.verdict).toBe('ready');
  });

  it('isSynthesisShaped is a light shape gate', () => {
    expect(isSynthesisShaped(null)).toBe(false);
    expect(isSynthesisShaped('not json')).toBe(false);
    expect(isSynthesisShaped(JSON.stringify({ verdict: 'ready' }))).toBe(false);
    expect(isSynthesisShaped(JSON.stringify(validSynthesis()))).toBe(true);
  });
});
