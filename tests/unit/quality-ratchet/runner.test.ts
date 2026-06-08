import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DecisionStore } from '@/planning/decision-store.js';
import { readQualityBaseline } from '@/quality-ratchet/baseline.js';
import {
  RATCHET_EXCEPTION_APPROVE,
  buildRatchetExceptionPacket,
} from '@/quality-ratchet/exception-decision.js';
import { runQualityRatchetGate } from '@/quality-ratchet/runner.js';

const NOW = () => '2026-06-08T00:00:00.000Z';

function project(strict: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-ratchet-runner-'));
  writeTsconfig(root, strict);
  mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  writeFileSync(join(root, 'docs/instructions/rules/module-map.yml'), 'version: 2\nmodules: []\n');
  return root;
}

function writeTsconfig(root: string, strict: boolean): void {
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict } }));
}

function baseRun(root: string, lane: 'fast' | 'graduated' | 'full' = 'full') {
  return {
    projectRoot: root,
    changedFiles: [],
    lane,
    stackProfile: null,
    deadCodeFiles: [] as string[] | null,
    now: NOW,
  };
}

describe('runQualityRatchetGate', () => {
  it('captures the baseline on the first run and passes (day-one reality)', async () => {
    const root = project(true);
    const result = await runQualityRatchetGate(baseRun(root));
    expect(result.status).toBe('captured');
    expect(await readQualityBaseline(root)).not.toBeNull();
  });

  it('passes and persists when nothing worsened on a second run', async () => {
    const root = project(true);
    await runQualityRatchetGate(baseRun(root));
    const result = await runQualityRatchetGate(baseRun(root));
    expect(result.status).toBe('pass');
  });

  it('refuses a strictness regression and does NOT move the recorded level', async () => {
    const root = project(true);
    await runQualityRatchetGate(baseRun(root)); // baseline at looseness 7
    const before = await readQualityBaseline(root);

    writeTsconfig(root, false); // loosen → looseness 15
    const result = await runQualityRatchetGate(baseRun(root));

    expect(result.status).toBe('regressed');
    expect(result.blocking_regressions[0]?.measure).toBe('strictness');
    // Refused change never writes the baseline.
    expect(await readQualityBaseline(root)).toEqual(before);
  });

  it('a strictness-loosening fast-lane change still trips the gate', async () => {
    const root = project(true);
    await runQualityRatchetGate(baseRun(root, 'fast'));
    writeTsconfig(root, false);
    const result = await runQualityRatchetGate(baseRun(root, 'fast'));
    expect(result.status).toBe('regressed');
  });

  it('permits a regression that was approved as an exception, and lifts the baseline', async () => {
    const root = project(true);
    await runQualityRatchetGate(baseRun(root));

    // Pre-approve a strictness exception in the DPC store.
    const store = new DecisionStore(root);
    store.initialize();
    store.resolveExisting({
      packet: buildRatchetExceptionPacket({
        decision_id: 'D-1',
        kind: 'quality.strictness',
        measure: 'strictness',
        module: '(project)',
        baseline_value: 7,
        current_value: 15,
        task_session_id: 'task-1',
        created_at: NOW(),
      }),
      humanResponse: {
        chosen_option_key: RATCHET_EXCEPTION_APPROVE,
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: NOW(),
        responded_by: 'human',
        carry_over_scope: 'task',
      },
      event: 'decision-resolved-by-human',
    });

    writeTsconfig(root, false);
    const result = await runQualityRatchetGate({ ...baseRun(root), decisionStore: store });

    expect(result.status).toBe('pass');
    expect(result.excepted_regressions).toHaveLength(1);
    const baseline = await readQualityBaseline(root);
    expect(baseline?.samples.find((s) => s.measure === 'strictness')?.value).toBe(15);
  });

  it('raises a pending pause for a still-blocking regression when a task id is given', async () => {
    const root = project(true);
    await runQualityRatchetGate(baseRun(root));
    const store = new DecisionStore(root);

    writeTsconfig(root, false);
    const result = await runQualityRatchetGate({
      ...baseRun(root),
      decisionStore: store,
      taskSessionId: 'task-99',
    });

    expect(result.status).toBe('regressed');
    expect(store.findPendingDecisionForTask('task-99')).not.toBeNull();
  });
});
