import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendAuthoringDefect,
  DEFECTS_LEDGER,
  gateFailureReceiptLine,
  readAuthoringDefects,
  recordGateFailure,
} from '@/authoring/evidence.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-defects-'));
  roots.push(root);
  return root;
}

describe('the authoring defects ledger', () => {
  it('appends one JSON line per defect with exactly skill, gate, evidence_path and at', () => {
    const root = project();
    appendAuthoringDefect(root, {
      skill: 'processing-invoices',
      gate: 'S5',
      evidence_path: '.paqad/tmp/authoring/skills/processing-invoices/iteration-1',
      at: '2026-10-31T12:00:00.000Z',
    });
    const text = readFileSync(join(root, DEFECTS_LEDGER), 'utf8');
    expect(DEFECTS_LEDGER).toBe('.paqad/ledger/authoring/defects.jsonl');
    expect(text.split('\n')).toHaveLength(2);
    expect(Object.keys(JSON.parse(text.split('\n')[0]!))).toEqual([
      'skill',
      'gate',
      'evidence_path',
      'at',
    ]);
  });

  it('reads back valid rows and skips broken lines', () => {
    const root = project();
    expect(readAuthoringDefects(root)).toEqual([]);
    const line = recordGateFailure(root, {
      skill: 'processing-invoices',
      gate: 'S4',
      evidencePath: 'lint.json',
      now: () => new Date('2026-10-31T00:00:00.000Z'),
    });
    appendFileSync(join(root, DEFECTS_LEDGER), 'not json\n{"skill":1}\n');
    expect(readAuthoringDefects(root)).toEqual([
      {
        skill: 'processing-invoices',
        gate: 'S4',
        evidence_path: 'lint.json',
        at: '2026-10-31T00:00:00.000Z',
      },
    ]);
    expect(line).toBe(gateFailureReceiptLine('processing-invoices', 'S4', 'lint.json'));
  });

  it('FR-66: says the exact receipt line for a gate a skill cannot pass', () => {
    expect(gateFailureReceiptLine('processing-invoices', 'S5', 'benchmark.json')).toBe(
      "I couldn't get the skill processing-invoices through its S5 check, so I didn't add it. " +
        'The evidence is in benchmark.json. This is ours to fix, not yours.',
    );
  });
});
