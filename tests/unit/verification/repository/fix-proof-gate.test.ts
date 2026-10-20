import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FixChange } from '@/core/types/fix-protocol.js';
import { openFeatureChange, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import {
  appendFixProofRow,
  foldFixProofState,
  type FixProofRow,
} from '@/fix-protocol/fix-proof-record.js';
import { evaluateFixProof, fixProofGate } from '@/verification/repository/fix-proof-gate.js';

const SES = 'ses-fix-proof-gate';

function row(phase: 'red' | 'green', outcome: FixProofRow['outcome']): FixProofRow {
  return {
    phase,
    outcome,
    test_file: 't',
    test_id: 'a > b',
    command: 'x',
    exit_code: 0,
    timed_out: false,
    duration_ms: 1,
    commit: null,
    tree_dirty: null,
    at: '2026-10-20T10:00:00.000Z',
    reason: outcome,
    output_tail: [],
  };
}

const SOURCE: FixChange = {
  files: [{ path: 'src/login.ts', added_lines: ['return x > 0;'], removed_lines: [] }],
};

describe('foldFixProofState', () => {
  it.each([
    [[], 'none'],
    [[row('red', 'error')], 'none'],
    [[row('red', 'red')], 'red'],
    [[row('red', 'red'), row('green', 'still-failing')], 'red'],
    [[row('red', 'red'), row('green', 'green')], 'red-green'],
    [[row('red', 'error'), row('red', 'red'), row('green', 'green')], 'red-green'],
    [[row('red', 'red'), row('green', 'held')], 'held'],
    [[row('red', 'red'), row('green', 'held'), row('green', 'green')], 'red-green'],
    [[row('green', 'green')], 'green-only'],
    [[row('green', 'green'), row('red', 'red')], 'green-only'],
    [[row('red', 'not-reproduced')], 'not-reproduced'],
  ] as const)('folds %j to %s', (rows, state) => {
    expect(foldFixProofState(rows as unknown as FixProofRow[])).toBe(state);
  });
});

describe('fix-proof gate', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-fix-proof-gate-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    dir = openFeatureChange(root, SES, { adapter: 'claude-code' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const evaluate = (readDiff: () => FixChange | null = () => SOURCE) =>
    evaluateFixProof({ projectRoot: root, dirName: dir, isFeatureDev: true }, { readDiff });

  it('stays silent outside feature development or without a change', () => {
    expect(evaluateFixProof({ projectRoot: root, dirName: dir, isFeatureDev: false })).toEqual({
      gate: null,
      summary: null,
    });
    expect(fixProofGate({ projectRoot: root, dirName: null, isFeatureDev: true }, null)).toBeNull();
  });

  it('reads not required, never a pass, for a change that is not a fix', () => {
    recordChangeConstants(root, dir, { kind: 'other' });
    const { gate, summary } = evaluate();
    expect(summary).toBeNull();
    expect(gate).toMatchObject({ status: 'skipped', skip_kind: 'not-required' });
  });

  it('reads not required for a fix touching only tests, docs or comments', () => {
    recordChangeConstants(root, dir, { kind: 'fix' });
    const { gate, summary } = evaluate(() => ({
      files: [
        { path: 'tests/a.test.ts', added_lines: ['x'], removed_lines: [] },
        { path: 'src/a.ts', added_lines: ['// why'], removed_lines: [] },
      ],
    }));
    expect(summary?.required).toBe(false);
    expect(gate).toMatchObject({ status: 'skipped', skip_kind: 'not-required' });
  });

  it.each([
    [[], 'none', 'fix prove red'],
    [[row('red', 'red')], 'red', 'fix prove green'],
    [[row('green', 'green')], 'green-only', 'undo the fix'],
    [[row('red', 'not-reproduced')], 'not-reproduced', 'Write a test'],
    [[row('red', 'red'), row('green', 'held')], 'held', 'broke'],
  ] as const)('reads Inconclusive did-not-run for %j', (rows, state, step) => {
    recordChangeConstants(root, dir, { kind: 'fix' });
    for (const r of rows) appendFixProofRow(root, dir, r as FixProofRow);
    const { gate, summary } = evaluate();
    expect(summary).toMatchObject({ required: true, state });
    expect(gate).toMatchObject({ status: 'inconclusive', skip_kind: 'did-not-run' });
    expect(gate?.remediation).toContain(step);
  });

  it('passes red then green for a behaviour-changing fix', () => {
    recordChangeConstants(root, dir, { kind: 'fix' });
    appendFixProofRow(root, dir, row('red', 'red'));
    appendFixProofRow(root, dir, row('green', 'green'));
    expect(evaluate().gate?.status).toBe('pass');
  });

  it('requires proof when the change diff cannot be read', () => {
    recordChangeConstants(root, dir, { kind: 'fix' });
    const { summary, gate } = evaluate(() => null);
    expect(summary).toMatchObject({ required: true, state: 'none' });
    expect(gate?.status).toBe('inconclusive');
  });
});
