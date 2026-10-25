import { describe, expect, it } from 'vitest';

import {
  GATE_CATALOG,
  VERIFICATION_GATES,
  gateExpectedOnLane,
  type GateResult,
} from '@/core/types/verification.js';
import { gateResultsToRows } from '@/evidence/fan-in.js';
import {
  GATE_STATE_LABEL,
  GATE_STRENGTH_TIER,
  LATE_GATE_STRENGTH_TIER,
  gateStateOf,
  gradeGateResult,
} from '@/evidence/grading.js';
import { GATE_JUDGED_AFTER } from '@/hud/change-scope.js';
import { buildVerificationEvidence } from '@/verification/evidence.js';
import { DEFAULT_GATE_CODES, VerificationGateRunner } from '@/verification/gate-runner.js';
import type { Gate } from '@/verification/gates/gate.interface.js';
import {
  createDidNotRun,
  createFail,
  createInconclusive,
  createNotRequired,
  createPass,
} from '@/verification/gates/shared.js';
import {
  buildRepositoryVerificationVerdict,
  receiptGateWord,
} from '@/verification/repository/verdict.js';

import { trustGates } from '../../../runtime/claude-plugin/mod/desktop-view.ts';
import { parseSnapshot } from '../../../runtime/claude-plugin/mod/model.ts';
import { FULL_ORD_501, fileText } from '../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type { PaqadHudSnapshot } from '../../../runtime/claude-plugin/mod/types/index.d.ts';

import { createVerificationContext } from './shared.fixture.js';

const TS = '2026-10-25T12:00:00.000Z';

function evidenceFor(results: GateResult[]) {
  return buildVerificationEvidence({
    results,
    context: {},
    run_id: 'run',
    started_at: TS,
    completed_at: TS,
  });
}

function hudWith(gates: Record<string, unknown>[], expected: string[]): PaqadHudSnapshot {
  return parseSnapshot(
    fileText({
      ...FULL_ORD_501,
      gates,
      gates_expected: expected,
      verdict: { schema: 'paqad.hud-verdict/1', kind: 'fail', word: 'x', reasons: [] },
    }),
  )!;
}

function hudRowFor(result: GateResult): Record<string, unknown> {
  const row = gateResultsToRows([result], { subjectDigest: 'd', ts: TS })[0]!;
  const verdict =
    row.verdict === 'skipped'
      ? row.skip_kind === 'did-not-run'
        ? 'did-not-run'
        : 'not-required'
      : row.verdict;
  return { name: result.gate, required: verdict !== 'not-required', strength: null, verdict };
}

function fixedGate(result: GateResult): Gate {
  return { gate: result.gate, check: async () => result };
}

describe('AC-27: one label per gate state across the status mapper, the receipt and the HUD', () => {
  const CASES: Array<[string, GateResult, string]> = [
    ['pass', createPass('spec-review', 'Spec review passed'), 'Pass'],
    [
      'could not prove',
      createInconclusive('spec-review', 'Nothing proves the review.', 'Review it.'),
      'Could not prove',
    ],
    ['did not run', createDidNotRun('spec-review', 'No input was supplied.'), 'Did not run'],
    ['not required', createNotRequired('spec-review', 'No spec stage.'), 'Not required'],
  ];

  it.each(CASES)('AC-27: %s reads the same in every reader', (_name, result, label) => {
    const state = gateStateOf(result);
    expect(GATE_STATE_LABEL[state]).toBe(label);

    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidenceFor([result]),
      escalations: [],
      evidencePath: null,
      flagOnGates: ['spec-review'],
    });
    const receiptGate = verdict.gates.find((gate) => gate.gate === 'spec-review')!;
    expect(receiptGateWord(receiptGate)).toBe(label);
    if (state !== 'pass') {
      expect(verdict.summary).toMatch(new RegExp(`spec[- ]review: ${label.toLowerCase()}`));
    }

    const hud = trustGates(hudWith([hudRowFor(result)], ['spec-review']));
    expect(hud.find((gate) => gate.name === 'spec-review')?.word).toBe(label);
  });

  it('AC-27: a gate with no row reads Did not run in the receipt and in the HUD once judged', () => {
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidenceFor([]),
      escalations: [],
      evidencePath: null,
    });
    const receiptGate = verdict.gates.find((gate) => gate.gate === 'mutation-testing')!;
    expect(receiptGateWord(receiptGate)).toBe('Did not run');
    const hud = trustGates(hudWith([], ['mutation-testing']));
    expect(hud[0]).toMatchObject({ name: 'mutation-testing', word: 'Did not run', required: true });
  });
});

describe('AC-7: gates skipped after a failure are recorded as did not run', () => {
  it('AC-7: the runner records each later gate as did not run, naming the failing gate', async () => {
    const runner = new VerificationGateRunner([
      fixedGate(createPass('change-completeness', 'ok')),
      fixedGate(createFail('ac-test-mapping', 'AC-1 has no test.', 'Add a test.')),
      fixedGate(createPass('spec-review', 'ok')),
      fixedGate(createPass('quality-ratchet', 'ok')),
    ]);
    const results = await runner.run(createVerificationContext());

    expect(results.map((result) => [result.gate, result.outcome ?? null])).toEqual([
      ['change-completeness', null],
      ['ac-test-mapping', null],
      ['spec-review', 'did-not-run'],
      ['quality-ratchet', 'did-not-run'],
    ]);
    expect(results[2]?.detail).toContain('ac-test-mapping');
    expect(results[2]?.passed).toBe(true);

    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidenceFor(results),
      escalations: [],
      evidencePath: null,
    });
    const skipped = verdict.gates.find((gate) => gate.gate === 'spec-review')!;
    expect(skipped).toMatchObject({ status: 'skipped', skip_kind: 'did-not-run' });
    expect(receiptGateWord(skipped)).toBe('Did not run');
    expect(verdict.summary).toContain('ac-test-mapping');
    expect(verdict.summary).not.toMatch(/spec review: not required/);

    const hud = trustGates(hudWith([hudRowFor(results[2]!)], ['spec-review']));
    expect(hud[0]?.word).toBe('Did not run');
  });
});

describe('the gate catalog is the one source for the gate lists', () => {
  it('derives the strength tiers, the judged-after stages and the default runner codes', () => {
    for (const gate of VERIFICATION_GATES) {
      expect(GATE_STRENGTH_TIER[gate]).toBe(GATE_CATALOG[gate].strength);
      expect(GATE_JUDGED_AFTER[gate]).toBe(GATE_CATALOG[gate].stage);
    }
    expect(LATE_GATE_STRENGTH_TIER['fix-proof']).toBe('deterministic');
    expect(GATE_JUDGED_AFTER['fix-proof']).toBe('development');
    expect(DEFAULT_GATE_CODES).toEqual(
      VERIFICATION_GATES.filter((gate) => GATE_CATALOG[gate].default_runner),
    );
  });

  it('expects only the gates whose stage is on the lane', () => {
    expect(gateExpectedOnLane('spec-review', 'fast')).toBe(false);
    expect(gateExpectedOnLane('implementation-review', 'fast')).toBe(false);
    expect(gateExpectedOnLane('code-tests-lint', 'fast')).toBe(true);
    expect(gateExpectedOnLane('spec-review', 'full')).toBe(true);
    expect(gateExpectedOnLane('spec-review', null)).toBe(true);
  });

  it('grades through the one status mapper with the catalog strength', () => {
    expect(gradeGateResult(createPass('spec-review', 'ok'))).toEqual({
      verdict: 'pass',
      strength_class: 'llm-judged',
    });
    expect(gradeGateResult({ gate: 'fix-proof', passed: false, detail: 'x' })).toEqual({
      verdict: 'fail',
      strength_class: 'deterministic',
    });
  });
});
