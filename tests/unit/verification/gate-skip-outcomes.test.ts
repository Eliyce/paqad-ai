import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import type { GateResult, VerificationContext } from '@/core/types/verification.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import { evidenceGatesToRows, gateResultsToRows } from '@/evidence/fan-in.js';
import { gradeGateResult } from '@/evidence/grading.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { buildVerificationEvidence } from '@/verification/evidence.js';
import { VerificationGateRunner } from '@/verification/gate-runner.js';
import type { Gate } from '@/verification/gates/gate.interface.js';
import { createDidNotRun, createNotRequired, createPass } from '@/verification/gates/shared.js';
import { backstopGates } from '@/verification/repository/run-repository-verification.js';
import { verdictKindFor } from '@/verification/verdict-kind.js';

import { createVerificationContext } from './shared.fixture.js';

// Issue #639, Part 10 — a gate can say not required or did not run. Both keep `passed: true`
// (so the runner and the verdict kind never move) and are recorded as `skipped` with a
// `skip_kind`, never as a pass (decision D-01M5AM0E9YEC7FBFHFN8N3SHCC).

const ROW_CTX = { subjectDigest: 'sha-subject', ts: '2026-10-19T12:00:00.000Z' };

/** A gate that returns a fixed result and counts how often it ran. */
function fixedGate(result: GateResult): Gate & { runs: number } {
  const gate = {
    gate: result.gate,
    runs: 0,
    async check() {
      gate.runs += 1;
      return result;
    },
  };
  return gate;
}

function evidenceFor(results: GateResult[]) {
  return buildVerificationEvidence({
    results,
    context: {},
    run_id: 'run',
    started_at: ROW_CTX.ts,
    completed_at: ROW_CTX.ts,
  });
}

const roots: string[] = [];
function context(overrides: Partial<VerificationContext> = {}): VerificationContext {
  const ctx = createVerificationContext(overrides);
  roots.push(ctx.project_root);
  return ctx;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('AC-6: not-required and did-not-run keep passed:true', () => {
  it('AC-6: createNotRequired and createDidNotRun keep passed true and set the outcome', () => {
    expect(createNotRequired('duplication', 'Not required: nothing to scan.')).toEqual({
      gate: 'duplication',
      passed: true,
      outcome: 'not-required',
      detail: 'Not required: nothing to scan.',
    });
    expect(createDidNotRun('mutation-testing', 'Did not run.')).toEqual({
      gate: 'mutation-testing',
      passed: true,
      outcome: 'did-not-run',
      detail: 'Did not run.',
    });
    expect(createDidNotRun('mutation-testing', 'Did not run.', 'Install the tool.')).toMatchObject({
      passed: true,
      outcome: 'did-not-run',
      remediation: 'Install the tool.',
    });
  });

  it.each([
    ['not required', createNotRequired('change-completeness', 'Not required.')],
    ['did not run', createDidNotRun('change-completeness', 'Did not run.')],
  ])(
    'AC-6: a %s gate first in the list lets the runner run the next gate, and the verdict kind matches a plain pass',
    async (_label, first) => {
      const failing: GateResult = {
        gate: 'mutation-testing',
        passed: false,
        detail: 'survivors',
        remediation: 'fix',
      };
      const skippedFirst = fixedGate(first);
      const passFirst = fixedGate(createPass('change-completeness', 'complete'));
      const next = fixedGate(failing);
      const nextAgain = fixedGate(failing);

      const withSkip = await new VerificationGateRunner([skippedFirst, next]).run(context());
      const withPass = await new VerificationGateRunner([passFirst, nextAgain]).run(context());

      expect(next.runs).toBe(1);
      expect(withSkip.map((r) => r.gate)).toEqual(['change-completeness', 'mutation-testing']);
      const kindWithSkip = verdictKindFor(evidenceFor(withSkip).gates);
      const kindWithPass = verdictKindFor(evidenceFor(withPass).gates);
      expect(kindWithSkip).toBe(kindWithPass);
      expect(evidenceFor(withSkip).overall_status).toBe(evidenceFor(withPass).overall_status);
    },
  );

  it('AC-6: a run of only skips reads the same verdict kind as a run of only passes', () => {
    const skips = evidenceFor([
      createNotRequired('duplication', 'Not required.'),
      createDidNotRun('quality-ratchet', 'Did not run.'),
    ]);
    const passes = evidenceFor([
      createPass('duplication', 'ok'),
      createPass('quality-ratchet', 'ok'),
    ]);
    expect(verdictKindFor(skips.gates)).toBe(verdictKindFor(passes.gates));
    expect(skips.overall_status).toBe('pass');
    expect(skips.first_failure_gate).toBeNull();
  });
});

describe('AC-7: evidence and ledger rows carry skipped + skip_kind, never pass', () => {
  const notRequired = createNotRequired('extension-surface', 'Not required: no barrel changed.');
  const didNotRun = createDidNotRun('mutation-testing', 'Mutation testing did not run.');

  it('AC-7: verification evidence records each as skipped with its skip_kind', () => {
    const gates = evidenceFor([notRequired, didNotRun]).gates;
    const byName = new Map(gates.map((gate) => [gate.name, gate]));
    expect(byName.get('extension-surface')).toMatchObject({
      status: 'skipped',
      skip_kind: 'not-required',
      detail: 'Not required: no barrel changed.',
    });
    expect(byName.get('mutation-testing')).toMatchObject({
      status: 'skipped',
      skip_kind: 'did-not-run',
    });
    expect(gates.some((gate) => gate.status === 'pass')).toBe(false);
  });

  it('AC-7: a gate with no result is a did-not-run placeholder', () => {
    const placeholder = evidenceFor([]).gates.find((gate) => gate.name === 'story-quality');
    expect(placeholder).toMatchObject({
      status: 'skipped',
      skip_kind: 'did-not-run',
      skip_reason: 'not checked in this run',
    });
  });

  it('AC-7: graded ledger rows are skipped with the kind, never pass', () => {
    const rows = gateResultsToRows([notRequired, didNotRun], ROW_CTX);
    expect(rows.map((row) => [row.code, row.verdict, row.skip_kind])).toEqual([
      ['extension-surface', 'skipped', 'not-required'],
      ['mutation-testing', 'skipped', 'did-not-run'],
    ]);
    expect(gradeGateResult(didNotRun)).toEqual({
      verdict: 'skipped',
      strength_class: 'deterministic',
      skip_kind: 'did-not-run',
    });
  });

  it('AC-7: evidence-gate rows carry the kind; a pre-Part-10 skipped gate carries none', () => {
    const gates: VerificationEvidenceGate[] = [
      {
        name: 'visual-evidence' as VerificationEvidenceGate['name'],
        status: 'skipped',
        detail: 'not-frontend',
        remediation: null,
        failures: [],
        skip_kind: 'not-required',
      },
      {
        name: 'bundle-completeness' as VerificationEvidenceGate['name'],
        status: 'skipped',
        detail: 'legacy skip',
        remediation: null,
        failures: [],
      },
    ];
    const [visual, legacy] = evidenceGatesToRows(gates, ROW_CTX);
    expect(visual).toMatchObject({ verdict: 'skipped', skip_kind: 'not-required' });
    expect(legacy?.verdict).toBe('skipped');
    expect(legacy && 'skip_kind' in legacy).toBe(false);
  });

  it('AC-7: the row builder drops a skip_kind on any verdict but skipped, and never hashes it', () => {
    const base = {
      ts: ROW_CTX.ts,
      engine: 'verification-gate' as const,
      code: 'duplication',
      subject_digest: 'sha',
      strength_class: 'deterministic' as const,
    };
    const pass = buildEvidenceRow({ ...base, verdict: 'pass', skip_kind: 'not-required' });
    expect('skip_kind' in pass).toBe(false);
    const withKind = buildEvidenceRow({ ...base, verdict: 'skipped', skip_kind: 'did-not-run' });
    const withoutKind = buildEvidenceRow({ ...base, verdict: 'skipped' });
    expect(withKind.skip_kind).toBe('did-not-run');
    expect(withKind.content_hash).toBe(withoutKind.content_hash);
  });
});

/**
 * Gates in backstopGates() that may still return a plain pass with empty inputs, and why. Each
 * one reads a verdict decided before the gate runs; the gate itself takes no measurement.
 */
const GENUINE_OR_UPSTREAM_PASSES: Record<string, string> = {
  // Reads `ac_test_mapping_passed`; #639 Part 11 (FR-12) replaces this canned pass with a
  // not-required / did-not-run reading. Remove it from this list when Part 11 lands.
  'ac-test-mapping': 'Part 11 owns this gate',
  // Read the recorded spec and implementation review verdicts the context builder computed.
  'spec-review': 'recorded review verdict',
  'implementation-review': 'recorded review verdict',
  // Measures registry freshness and glossary state, which exist with or without a diff.
  'documentation-freshness': 'measures registries and glossary',
};

describe('AC-27: no backstop gate claims a measurement on empty inputs', () => {
  it('AC-27: every gate in backstopGates() run with empty inputs reads not required or did not run unless allow-listed', async () => {
    const ctx = context({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      changed_files: [],
      code_changed: false,
    });
    const plainPasses: string[] = [];
    const seen: string[] = [];
    for (const gate of backstopGates()) {
      const result = await gate.check(ctx);
      seen.push(result.gate);
      if (result.passed && result.outcome === undefined && !result.inconclusive) {
        plainPasses.push(result.gate);
      }
    }
    expect(seen).toContain('mutation-testing');
    expect(seen).toContain('quality-ratchet');
    expect(plainPasses.filter((gate) => !(gate in GENUINE_OR_UPSTREAM_PASSES))).toEqual([]);
  });
});
