import { describe, expect, it } from 'vitest';

import { GATE_STATE_LABEL } from '@/evidence/grading.js';
import type { HudGate, HudStage } from '@/hud/snapshot.js';
import { PROOF_GATE_WORDS, buildStageProof, type StageProofInput } from '@/hud/stage-proof.js';

const stage = (name: string, state: string): HudStage => ({
  stage: name,
  state,
  mandatory: true,
  started_at: null,
  ended_at: null,
  duration_ms: null,
  duration_unreliable: false,
  agent: null,
  proof_file: null,
});

const gate = (name: string, verdict: HudGate['verdict']): HudGate => ({
  name,
  required: verdict !== 'not-required',
  strength: 'deterministic',
  verdict,
});

const EMPTY: StageProofInput = {
  lane: 'fast',
  stages: [],
  gates: [],
  judged: false,
  plan: null,
  planProgress: null,
  spec: null,
  experts: null,
  questions: null,
  rules: null,
  changedFiles: null,
  review: null,
  checks: null,
  siteMap: false,
};

const NEVER_RUN = [
  'requirement-completeness',
  'story-quality',
  'architecture-compliance',
  'behavioral-correctness',
  'database-quality',
];

describe('AC-8 and AC-36: Trust proof on the fast lane', () => {
  const proof = buildStageProof({
    ...EMPTY,
    stages: [
      stage('planning', 'complete'),
      stage('development', 'complete'),
      stage('checks', 'complete'),
    ],
    gates: [
      gate('change-completeness', 'pass'),
      gate('code-tests-lint', 'pass'),
      gate('spec-review', 'not-judged'),
      gate('architecture-compliance', 'did-not-run'),
      gate('stage-evidence', 'fail'),
    ],
    judged: true,
    plan: { steps: 3, reuse: 2 },
    planProgress: { steps: 3, done: 3 },
    rules: 12,
    changedFiles: ['src/a.ts', 'src/b.ts'],
    checks: { passed: true, commands: 4, failed: 0 },
  });

  it('holds one entry per fast-lane stage, in order', () => {
    expect(proof.map((entry) => [entry.stage, entry.words, entry.state])).toEqual([
      ['planning', 'Plan', 'complete'],
      ['development', 'Build', 'complete'],
      ['checks', 'Checks', 'complete'],
    ]);
  });

  it('lists each stage steps from the recorded evidence', () => {
    expect(proof[0]!.steps).toEqual([
      { id: 'plan', words: 'Plan compiled', detail: '3 steps', state: 'done' },
      { id: 'reuse', words: 'Reuse checked', detail: '2 sources consulted', state: 'done' },
    ]);
    expect(proof[1]!.steps).toEqual([
      { id: 'rules', words: 'Rules loaded', detail: '12 rules apply', state: 'done' },
      { id: 'edits', words: 'Edits made', detail: '2 files changed', state: 'done' },
      { id: 'built', words: 'Plan steps built', detail: '3 of 3', state: 'done' },
    ]);
    expect(proof[2]!.steps).toEqual([
      { id: 'checks', words: 'Checks passed', detail: '4 of 4 commands', state: 'done' },
    ]);
  });

  it('shows only gates of the lane that a paqad path runs, never a spec, review or docs gate', () => {
    const codes = proof.flatMap((entry) => entry.gates.map((row) => row.code));
    expect(codes).toEqual([
      'change-completeness',
      'extension-surface',
      'duplication',
      'ac-test-mapping',
      'code-tests-lint',
      'mutation-testing',
      'quality-ratchet',
    ]);
    for (const code of [...NEVER_RUN, 'spec-review', 'implementation-review', 'stage-evidence']) {
      expect(codes).not.toContain(code);
    }
    expect(proof.flatMap((entry) => entry.gates).some((row) => row.state === 'not-judged')).toBe(
      false,
    );
  });

  it('reads a gate with no row as did not run once the change is judged, in plain words', () => {
    const build = proof[1]!.gates;
    expect(build[0]).toEqual({
      code: 'change-completeness',
      words: 'Nothing left half done',
      state: 'pass',
    });
    expect(build[1]).toEqual({
      code: 'extension-surface',
      words: 'Public surface stays stable',
      state: 'did-not-run',
    });
  });
});

describe('AC-35: Trust proof on the full lane', () => {
  it('holds the six full-lane stages with their own gates, and the site map only when it is on', () => {
    const off = buildStageProof({ ...EMPTY, lane: 'full' });
    expect(off.map((entry) => entry.words)).toEqual([
      'Plan',
      'Spec',
      'Build',
      'Review',
      'Checks',
      'Docs',
    ]);
    expect(off[1]!.gates.map((row) => row.code)).toEqual(['spec-review']);
    expect(off[3]!.gates.map((row) => row.code)).toEqual(['implementation-review']);
    expect(off[5]!.gates.map((row) => row.code)).toEqual([
      'module-docs-structure',
      'instructions-docs-structure',
      'documentation-freshness',
    ]);
    const on = buildStageProof({ ...EMPTY, lane: 'full', siteMap: true });
    expect(on[5]!.gates.map((row) => row.code)).toContain('site-map-freshness');
    const codes = on.flatMap((entry) => entry.gates.map((row) => row.code));
    for (const code of NEVER_RUN) expect(codes).not.toContain(code);
  });

  it('reads the spec, review, checks and docs steps from their evidence', () => {
    const proof = buildStageProof({
      ...EMPTY,
      lane: 'full',
      stages: [stage('documentation_sync', 'complete')],
      spec: { grounded: 5, criteria: 9, frozen: true },
      experts: 7,
      questions: { asked: 4, answered: 2, auto_answered: 1, deferred: 1 },
      review: { findings: 2 },
      changedFiles: ['docs/a.md', 'src/x.ts'],
      checks: { passed: false, commands: 4, failed: 1 },
    });
    expect(proof[1]!.steps).toEqual([
      { id: 'grounded', words: 'Grounded in the code', detail: '5 references', state: 'done' },
      { id: 'experts', words: 'Experts seated', detail: '7 experts', state: 'done' },
      { id: 'questions', words: 'Questions answered', detail: '3 of 4', state: 'not-yet' },
      { id: 'frozen', words: 'Spec frozen', detail: '9 criteria', state: 'done' },
    ]);
    expect(proof[3]!.steps).toEqual([
      { id: 'review', words: 'Review recorded', detail: '2 findings', state: 'done' },
    ]);
    expect(proof[4]!.steps).toEqual([
      { id: 'checks', words: 'Checks failed', detail: '1 of 4 commands failed', state: 'failed' },
    ]);
    expect(proof[5]!.steps).toEqual([
      { id: 'docs', words: 'Docs updated', detail: '1 file changed', state: 'done' },
    ]);
  });

  it('marks every step not yet when nothing is recorded, and gates not judged yet before a verdict', () => {
    const proof = buildStageProof({ ...EMPTY, lane: 'full' });
    expect(proof.flatMap((entry) => entry.steps).every((step) => step.state === 'not-yet')).toBe(
      true,
    );
    expect(proof.flatMap((entry) => entry.gates).every((row) => row.state === 'not-judged')).toBe(
      true,
    );
    expect(proof[0]!.steps[0]).toEqual({
      id: 'plan',
      words: 'Plan compiled',
      detail: null,
      state: 'not-yet',
    });
    expect(proof[0]!.state).toBe('missing');
  });
});

describe('gate states are worded as the receipt words them', () => {
  it('uses the receipt labels for the five judged states', () => {
    for (const [state, label] of Object.entries(GATE_STATE_LABEL)) {
      expect(PROOF_GATE_WORDS[state as keyof typeof GATE_STATE_LABEL]).toBe(label);
    }
  });
});
