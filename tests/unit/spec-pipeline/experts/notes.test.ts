import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assembleExpertRun } from '@/spec-pipeline/experts/assemble.js';
import {
  readExpertNeed,
  readExpertNotes,
  validateExpertNotes,
  writeExpertNeed,
  writeExpertNotes,
} from '@/spec-pipeline/experts/notes.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-expert-notes-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const DIR = '521-x-01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('validateExpertNotes', () => {
  it('accepts well-formed notes + tokens', () => {
    const result = validateExpertNotes({
      notes: [{ role: 'db-expert', findings: [{ target: 'invoices', claim: 'index it' }] }],
      tokens: { 'db-expert': 900 },
    });
    expect(result.ok).toBe(true);
    expect(result.artifact?.notes[0]?.role).toBe('db-expert');
    expect(result.artifact?.tokens['db-expert']).toBe(900);
  });

  it('accepts a JSON string and omitted tokens', () => {
    const result = validateExpertNotes('{"notes":[{"role":"db-expert","findings":[]}]}');
    expect(result.ok).toBe(true);
    expect(result.artifact?.tokens).toEqual({});
  });

  it('rejects invalid JSON, a non-object, and a missing notes[]', () => {
    expect(validateExpertNotes('{bad').ok).toBe(false);
    expect(validateExpertNotes(7).ok).toBe(false);
    expect(validateExpertNotes({ nope: 1 }).ok).toBe(false);
  });

  it('rejects a note role outside the roster', () => {
    const r = validateExpertNotes({ notes: [{ role: 'implementer', findings: [] }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not an expert in the roster/);
  });

  it('rejects a non-object note, missing findings[], and bad findings', () => {
    expect(validateExpertNotes({ notes: ['x'] }).ok).toBe(false);
    expect(validateExpertNotes({ notes: [{ role: 'db-expert' }] }).ok).toBe(false);
    expect(validateExpertNotes({ notes: [{ role: 'db-expert', findings: ['x'] }] }).ok).toBe(false);
    expect(
      validateExpertNotes({
        notes: [{ role: 'db-expert', findings: [{ target: '', claim: 'c' }] }],
      }).ok,
    ).toBe(false);
    expect(
      validateExpertNotes({
        notes: [{ role: 'db-expert', findings: [{ target: 't', claim: '  ' }] }],
      }).ok,
    ).toBe(false);
  });

  it('rejects a bad tokens map', () => {
    expect(validateExpertNotes({ notes: [], tokens: [] }).ok).toBe(false);
    expect(validateExpertNotes({ notes: [], tokens: { implementer: 1 } }).ok).toBe(false);
    expect(validateExpertNotes({ notes: [], tokens: { 'db-expert': -1 } }).ok).toBe(false);
    expect(validateExpertNotes({ notes: [], tokens: { 'db-expert': 'x' } }).ok).toBe(false);
  });
});

describe('need/notes store', () => {
  it('round-trips through the scratch', () => {
    const root = tempRoot();
    expect(readExpertNeed(root, DIR)).toBeNull();
    expect(readExpertNotes(root, DIR)).toBeNull();
    writeExpertNeed(root, DIR, { experts: [{ role: 'db-expert', reason: 'r' }] });
    writeExpertNotes(root, DIR, { notes: [], tokens: {} });
    expect(readExpertNeed(root, DIR)).toEqual({ experts: [{ role: 'db-expert', reason: 'r' }] });
    expect(readExpertNotes(root, DIR)).toEqual({ notes: [], tokens: {} });
  });
});

describe('assembleExpertRun', () => {
  it('returns null when no need artifact was recorded (flag-off equivalent)', () => {
    expect(assembleExpertRun(tempRoot(), DIR, 20000)).toBeNull();
  });

  it('returns null when the recorded need artifact is invalid', () => {
    const root = tempRoot();
    writeExpertNeed(root, DIR, { experts: [{ role: 'implementer', reason: 'x' }] });
    expect(assembleExpertRun(root, DIR, 20000)).toBeNull();
  });

  it('assembles accounting + conflicts from need + notes (FR-7/AC-9)', () => {
    const root = tempRoot();
    writeExpertNeed(root, DIR, {
      experts: [
        { role: 'db-expert', reason: 'migration' },
        { role: 'data-modeler', reason: 'model' },
      ],
    });
    writeExpertNotes(root, DIR, {
      notes: [
        { role: 'db-expert', findings: [{ target: 'orders', claim: 'denormalise' }] },
        { role: 'data-modeler', findings: [{ target: 'orders', claim: 'normalise' }] },
      ],
      tokens: { 'db-expert': 1000, 'data-modeler': 500 },
    });
    const run = assembleExpertRun(root, DIR, 20000);
    expect(run).not.toBeNull();
    expect(run!.accounting.experts).toHaveLength(2);
    expect(run!.accounting.total_tokens).toBe(1500);
    // Contradiction on `orders` ⇒ a surfaced conflict, and neither expert changed the spec.
    expect(run!.conflicts).toHaveLength(1);
    expect(run!.accounting.experts.every((e) => e.changed_spec === false)).toBe(true);
  });

  it('assembles from need alone (no notes yet) with zero tokens', () => {
    const root = tempRoot();
    writeExpertNeed(root, DIR, { experts: [{ role: 'db-expert', reason: 'migration' }] });
    const run = assembleExpertRun(root, DIR, 20000);
    expect(run!.accounting.experts).toEqual([
      { role: 'db-expert', reason: 'migration', tokens: 0, changed_spec: false },
    ]);
    expect(run!.conflicts).toEqual([]);
  });

  it('carries the slice ceiling warning through when budgets exceed the ceiling (AC-6)', () => {
    const root = tempRoot();
    writeExpertNeed(root, DIR, {
      experts: [
        { role: 'db-expert', reason: 'a' },
        { role: 'security-auditor', reason: 'b' },
      ],
    });
    const run = assembleExpertRun(root, DIR, 100);
    expect(run!.accounting.warnings.some((w) => /none dropped/.test(w))).toBe(true);
  });

  it('ignores an invalid notes artifact and still assembles from the valid need', () => {
    const root = tempRoot();
    writeExpertNeed(root, DIR, { experts: [{ role: 'db-expert', reason: 'a' }] });
    writeExpertNotes(root, DIR, { notes: [{ role: 'implementer', findings: [] }] });
    const run = assembleExpertRun(root, DIR, 20000);
    expect(run!.accounting.experts[0]?.changed_spec).toBe(false);
  });
});
