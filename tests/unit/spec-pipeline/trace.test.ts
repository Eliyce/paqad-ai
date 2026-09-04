import { describe, expect, it } from 'vitest';

import { carryForwardIds, validateTrace, type TraceArtifact } from '@/spec-pipeline/trace.js';

describe('carryForwardIds', () => {
  it('assigns fresh sequential ids per kind on a first craft', () => {
    const out = carryForwardIds(
      [
        { kind: 'FR', source: 'task.intent' },
        { kind: 'FR', source: 'answer:D-1' },
        { kind: 'AC', source: 'task.explicit_inclusions[0]' },
      ],
      null,
    );
    expect(out.entries.map((e) => e.id)).toEqual(['FR-1', 'FR-2', 'AC-1']);
  });

  it('re-craft: unchanged source keeps id, new source gets a new id, removed id is retired and never reused (FR-6-T3)', () => {
    const previous: TraceArtifact = {
      entries: [
        { id: 'FR-1', kind: 'FR', source: 'task.intent' },
        { id: 'FR-2', kind: 'FR', source: 'answer:D-1' },
      ],
    };
    // FR-2's source ('answer:D-1') is removed; a genuinely new source appears.
    const out = carryForwardIds(
      [
        { kind: 'FR', source: 'task.intent' }, // unchanged → keeps FR-1
        { kind: 'FR', source: 'answer:D-9' }, // new → must NOT reuse FR-2
      ],
      previous,
    );
    const bySource = new Map(out.entries.map((e) => [e.source, e.id]));
    expect(bySource.get('task.intent')).toBe('FR-1');
    expect(bySource.get('answer:D-9')).toBe('FR-3'); // FR-2 retired, not reused
  });

  it('is deterministic (exact source match, no fuzzy content matching)', () => {
    const current = [
      { kind: 'AC' as const, source: 's1' },
      { kind: 'AC' as const, source: 's2' },
    ];
    expect(carryForwardIds(current, null)).toEqual(carryForwardIds(current, null));
  });
});

describe('validateTrace', () => {
  it('passes when every entry has a source', () => {
    expect(validateTrace({ entries: [{ id: 'FR-1', kind: 'FR', source: 'task.intent' }] }).ok).toBe(
      true,
    );
  });

  it('flags an unsourced (invented) requirement, naming it (FR-6.2)', () => {
    const r = validateTrace({
      entries: [
        { id: 'FR-1', kind: 'FR', source: 'task.intent' },
        { id: 'FR-2', kind: 'FR', source: '  ' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.unsourced).toEqual(['FR-2']);
  });
});
