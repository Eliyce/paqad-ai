import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentRole } from '@/core/types/agent.js';
import { assembleExpertRun } from '@/spec-pipeline/experts/assemble.js';
import { validateExpertNotes } from '@/spec-pipeline/experts/notes.js';
import { writeExpertNotes, writeExpertRoster } from '@/spec-pipeline/run-store.js';

/** Record a roster the way `experts record` does (issue #581: the need lives in experts.json). */
function writeExpertNeed(
  root: string,
  dir: string,
  need: { experts: { role: string; reason: string }[] },
): void {
  writeExpertRoster(
    root,
    dir,
    need.experts.map((expert) => ({
      role: expert.role as AgentRole,
      reason: expert.reason,
      lens: 'lens',
      budget_tokens: 1000,
      grounding_truncated: false,
      brief_hash: 'h',
      tokens_used: null,
    })),
  );
}

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

  // Issue #547 — the additive FR-4.4 validation.
  it('defaults kind/severity and assigns EX-<role>-<n> ids in note order', () => {
    const result = validateExpertNotes({
      notes: [
        {
          role: 'db-expert',
          findings: [
            { target: 'invoices', claim: 'index it' },
            {
              target: 'line_items',
              claim: 'add a foreign key',
              kind: 'invariant',
              severity: 'must',
            },
          ],
        },
        {
          role: 'security-auditor',
          findings: [{ target: 'export', claim: 'scope to the customer' }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    const dbFindings = result.artifact!.notes[0]!.findings;
    expect(dbFindings[0]).toMatchObject({
      id: 'EX-db-expert-1',
      kind: 'requirement',
      severity: 'should',
    });
    expect(dbFindings[1]).toMatchObject({
      id: 'EX-db-expert-2',
      kind: 'invariant',
      severity: 'must',
    });
    expect(result.artifact!.notes[1]!.findings[0]!.id).toBe('EX-security-auditor-1');
  });

  it('keeps an optional evidence string and rejects a non-string one', () => {
    expect(
      validateExpertNotes({
        notes: [
          { role: 'db-expert', findings: [{ target: 't', claim: 'c', evidence: 'doc: x.md' }] },
        ],
      }).artifact!.notes[0]!.findings[0]!.evidence,
    ).toBe('doc: x.md');
    expect(
      validateExpertNotes({
        notes: [{ role: 'db-expert', findings: [{ target: 't', claim: 'c', evidence: 5 }] }],
      }).error,
    ).toMatch(/evidence must be a string/);
  });

  it('rejects an unknown kind or severity', () => {
    expect(
      validateExpertNotes({
        notes: [{ role: 'db-expert', findings: [{ target: 't', claim: 'c', kind: 'wish' }] }],
      }).error,
    ).toMatch(/unknown kind/);
    expect(
      validateExpertNotes({
        notes: [
          { role: 'db-expert', findings: [{ target: 't', claim: 'c', severity: 'blocker' }] },
        ],
      }).error,
    ).toMatch(/unknown severity/);
  });

  it('accepts a note question and rejects a malformed one', () => {
    const ok = validateExpertNotes({
      notes: [
        {
          role: 'db-expert',
          findings: [],
          questions: [
            {
              business_text: 'How large is the invoices table expected to get?',
              why_it_matters: 'a bulk export on a big table needs a plan',
              options: ['thousands', 'millions'],
              grounded_in: null,
            },
          ],
        },
      ],
    });
    expect(ok.ok).toBe(true);
    expect(ok.artifact!.notes[0]!.questions).toHaveLength(1);
    expect(
      validateExpertNotes({
        notes: [{ role: 'db-expert', findings: [], questions: [{ business_text: '' }] }],
      }).error,
    ).toMatch(/business_text/);
    expect(
      validateExpertNotes({
        notes: [{ role: 'db-expert', findings: [], questions: 'nope' }],
      }).error,
    ).toMatch(/questions must be an array/);
  });

  it('runs the plain-language check over questions when sources are supplied', () => {
    const result = validateExpertNotes(
      {
        notes: [
          {
            role: 'db-expert',
            findings: [],
            questions: [
              {
                business_text: 'idempotency key on the mutation endpoint',
                why_it_matters: 'matters',
                options: ['a', 'b'],
                grounded_in: null,
              },
            ],
          },
        ],
      },
      { terms: [], prompt: 'plain words only' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plain language|flagged/);
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
        {
          role: 'db-expert',
          findings: [{ id: 'EX-db-expert-1', target: 'orders', claim: 'denormalise' }],
        },
        {
          role: 'data-modeler',
          findings: [{ id: 'EX-data-modeler-1', target: 'orders', claim: 'normalise' }],
        },
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

  it('assembles from the need when the recorded notes carry no findings', () => {
    const root = tempRoot();
    writeExpertNeed(root, DIR, { experts: [{ role: 'db-expert', reason: 'a' }] });
    writeExpertNotes(root, DIR, { notes: [{ role: 'db-expert', findings: [] }], tokens: {} });
    const run = assembleExpertRun(root, DIR, 20000);
    expect(run!.accounting.experts[0]?.changed_spec).toBe(false);
  });
});
