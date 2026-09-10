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

// Issue #547 — the craft-trace gate, the writer/reader, and the raw parser.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach } from 'vitest';

import {
  extractRequirementIds,
  parseTraceArtifact,
  readTrace,
  validateCraftTrace,
  writeTrace,
} from '@/spec-pipeline/trace.js';

const _roots: string[] = [];
function _tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-trace-'));
  _roots.push(r);
  return r;
}
afterEach(() => {
  while (_roots.length > 0) rmSync(_roots.pop()!, { recursive: true, force: true });
});

const SPEC = [
  '## Functional requirements',
  '- FR-1: index invoices.customer_id',
  '## Acceptance criteria',
  '- AC-1: given a lookup, when it runs, then it uses the index (proof: automated)',
  '## Invariants',
  '- INV-1: the index exists',
].join('\n');

describe('extractRequirementIds', () => {
  it('collects the FR/NFR/AC/INV ids a spec declares', () => {
    expect(extractRequirementIds(SPEC).sort()).toEqual(['AC-1', 'FR-1', 'INV-1']);
  });
});

describe('validateCraftTrace', () => {
  const fullTrace: TraceArtifact = {
    entries: [
      { id: 'FR-1', kind: 'FR', source: 'EX-db-expert-1' },
      { id: 'AC-1', kind: 'AC', source: 'task.intent' },
      { id: 'INV-1', kind: 'INV', source: 'EX-db-expert-1' },
    ],
  };

  it('accepts a fully traced spec with every accepted finding reflected', () => {
    expect(validateCraftTrace(SPEC, fullTrace, ['EX-db-expert-1']).ok).toBe(true);
  });

  it('refuses a requirement line with no trace entry, naming it', () => {
    const partial: TraceArtifact = { entries: [fullTrace.entries[0]!, fullTrace.entries[1]!] };
    const r = validateCraftTrace(SPEC, partial, []);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/line "INV-1" has no source/);
  });

  it('refuses an entry with an empty source', () => {
    const bad: TraceArtifact = {
      entries: [
        { id: 'FR-1', kind: 'FR', source: '' },
        { id: 'AC-1', kind: 'AC', source: 'task.intent' },
        { id: 'INV-1', kind: 'INV', source: 'task.intent' },
      ],
    };
    expect(validateCraftTrace(SPEC, bad, []).errors.join(' ')).toMatch(/line "FR-1" has no source/);
  });

  it('refuses an accepted finding that is reflected nowhere', () => {
    const r = validateCraftTrace(SPEC, fullTrace, ['EX-db-expert-1', 'EX-qa-engineer-1']);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/not reflected in the spec: EX-qa-engineer-1/);
  });
});

describe('trace scratch io + parseTraceArtifact', () => {
  it('writes and reads a trace, and returns null when absent', () => {
    const root = _tempRoot();
    expect(readTrace(root, 'c1')).toBeNull();
    writeTrace(root, 'c1', { entries: [{ id: 'FR-1', kind: 'FR', source: 's' }] });
    expect(readTrace(root, 'c1')?.entries[0]?.id).toBe('FR-1');
  });

  it('parses a raw trace, deriving kind from the id, and rejects malformed input', () => {
    const parsed = parseTraceArtifact({ entries: [{ id: 'AC-2', source: 'task.x' }] });
    expect(parsed?.entries[0]).toEqual({ id: 'AC-2', kind: 'AC', source: 'task.x' });
    expect(parseTraceArtifact({ entries: [{ id: 'ZZ-1', source: 's' }] })).toBeNull();
    expect(parseTraceArtifact({ entries: [{ id: 'FR-1' }] })).toBeNull();
    expect(parseTraceArtifact({ nope: true })).toBeNull();
    expect(parseTraceArtifact(null)).toBeNull();
  });
});

// Issue #547 — remaining branches (coverage).
describe('trace io edge branches', () => {
  it('readTrace returns null on corrupt json and on a non-array entries', () => {
    const root = _tempRoot();
    writeTrace(root, 'c9', { entries: [] });
    // Corrupt the file.
    const abs = join(root, '.paqad', '_specs', 'c9', 'pipeline', 'trace.json');
    writeFileSync(abs, '{not json');
    expect(readTrace(root, 'c9')).toBeNull();
  });

  it('parseTraceArtifact rejects a non-object entry', () => {
    expect(parseTraceArtifact({ entries: ['x'] })).toBeNull();
    expect(parseTraceArtifact('nope')).toBeNull();
  });
});
