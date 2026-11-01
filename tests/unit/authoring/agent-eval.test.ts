import { afterEach, describe, expect, it } from 'vitest';

import { runAgentEvalPlan, runAgentEvalRecord } from '@/authoring/stages/agent-eval.js';
import { AGENT_STAGES, AuthoringRefusal, MODE_FILE, stageState } from '@/authoring/workspace.js';

import {
  AGENT_INTAKE,
  addCase,
  agentForEval,
  cleanAgentProjects,
  readLoose,
  writeTrials,
} from '../../shared/agent-pipeline.js';

afterEach(cleanAgentProjects);

function reviewer() {
  const workspace = agentForEval();
  addCase(workspace, 'drops-column', { adversarial: true });
  addCase(workspace, 'clean-migration', { clean_input: true });
  return workspace;
}

describe('agent eval plan (S5)', () => {
  it('plans 3 trials per arm per tier in a new iteration folder with the worst-case spend', () => {
    const workspace = reviewer();
    const result = runAgentEvalPlan(workspace);
    expect(result.ok).toBe(true);
    const plan = workspace.readJson<Record<string, unknown>>('iteration-1/plan.json')!;
    expect(plan).toMatchObject({
      iteration: 1,
      arms: ['with_agent', 'main_thread'],
      trials_per_arm: 3,
      total_trials: 24,
      fresh_context: true,
      clean_repo_state: true,
      batch: 'unavailable',
    });
    expect(result.lines[0]).toMatch(/24 trials, worst-case spend \$/);
    expect(() => runAgentEvalPlan(workspace)).toThrow(/planned but not recorded/);
  });

  it('AC-7: a reviewer case set needs a clean input', () => {
    const workspace = agentForEval();
    addCase(workspace, 'a', { adversarial: true });
    addCase(workspace, 'b');
    expect(() => runAgentEvalPlan(workspace)).toThrow(/clean input/);
  });

  it('needs at least two cases, one adversarial, each with repo state, inputs and the expected end state', () => {
    const workspace = agentForEval();
    addCase(workspace, 'a', { adversarial: true });
    expect(() => runAgentEvalPlan(workspace)).toThrow(/at least 2 task cases/);
    addCase(workspace, 'b', { clean_input: true, expected: '' });
    expect(() => runAgentEvalPlan(workspace)).toThrow(/is missing expected/);
    addCase(workspace, 'b', { clean_input: true });
    addCase(workspace, 'a');
    expect(() => runAgentEvalPlan(workspace)).toThrow(/adversarial/);
  });

  it('AC-18: a memory candidate adds a with_agent_memory arm; a one-shot agent has none', () => {
    const memory = agentForEval({ ...AGENT_INTAKE, memory: 'candidate' });
    addCase(memory, 'a', { adversarial: true, clean_input: true });
    addCase(memory, 'b');
    runAgentEvalPlan(memory);
    expect(memory.readJson<{ arms: string[] }>('iteration-1/plan.json')?.arms).toEqual([
      'with_agent',
      'main_thread',
      'with_agent_memory',
    ]);
  });

  it('an edited agent is judged against old_agent, and later iterations name their lever', () => {
    const workspace = reviewer();
    workspace.writeJson(MODE_FILE, { entry: 'improve' });
    runAgentEvalPlan(workspace);
    expect(
      workspace.readJson<{ baseline_arm: string }>('iteration-1/plan.json')?.baseline_arm,
    ).toBe('old_agent');
  });

  it('EC-A01: a host with no subagents records not deployable and proposes a skill', () => {
    const workspace = agentForEval(AGENT_INTAKE, 'cursor');
    addCase(workspace, 'a', { adversarial: true, clean_input: true });
    addCase(workspace, 'b');
    const result = runAgentEvalPlan(workspace);
    expect(result.ok).toBe(false);
    expect(workspace.readJson<Record<string, unknown>>('benchmark.json')).toMatchObject({
      deployable: { cursor: false },
    });
    expect(result.lines[0]).toMatch(/Propose a skill/);
  });

  it('the plugin eval adapter writes a wrapper carrying agents/<name>.md', () => {
    const workspace = agentForEval(AGENT_INTAKE, 'claude-code');
    addCase(workspace, 'a', { adversarial: true, clean_input: true });
    addCase(workspace, 'b');
    const result = runAgentEvalPlan(workspace, { probe: () => '2.1.302' });
    expect(result.lines.join('\n')).toMatch(
      /claude plugin eval .* --ablation with-without --runs 3/,
    );
    expect(workspace.exists('iteration-1/plugin/agents/migration-reviewer.md')).toBe(true);
  });
});

describe('agent eval record (S5)', () => {
  it('AC-6, AC-43: records pass^3 and pass@3 separately with cost and latency deltas, tiers side by side', async () => {
    const workspace = reviewer();
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: trial.arm === 'with_agent' ? {} : { duration_ms: 1500, cost_usd: 0.005 },
    }));
    const result = await runAgentEvalRecord(workspace);
    expect(result.ok).toBe(true);
    const benchmark = readLoose(workspace, 'benchmark.json');
    expect(benchmark.pass_hat_k).toBe(1);
    expect(
      benchmark.reliability.map((entry) => [
        entry.arm,
        entry.tier,
        entry.pass_hat_k,
        entry.pass_at_k,
      ]),
    ).toEqual([
      ['main_thread', 'fast', 0, 0],
      ['main_thread', 'reasoning', 0, 0],
      ['with_agent', 'fast', 1, 1],
      ['with_agent', 'reasoning', 1, 1],
    ]);
    expect(benchmark.summary.cost).toEqual({
      median_with: 0.01,
      median_baseline: 0.005,
      delta_usd: 0.005,
    });
    expect(benchmark.summary.latency.p95_delta_ms).toBe(500);
    expect(benchmark.tiers.map((entry) => entry.tier)).toEqual(['fast', 'reasoning']);
    expect(benchmark.registered_tier).toBe('fast');
    expect(benchmark.creation_cost_usd.S5).toBeGreaterThan(0);
    expect(workspace.exists('iteration-1/benchmark.json')).toBe(true);
    expect(stageState(workspace, AGENT_STAGES[5]!).state).toBe('passed');
  });

  it('AC-32: a baseline matching the agent fails as no gain', async () => {
    const workspace = reviewer();
    runAgentEvalPlan(workspace);
    writeTrials(workspace, () => ({ passed: true }));
    const result = await runAgentEvalRecord(workspace);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toMatch(/no gain/);
  });

  it('AC-57: refuses a trial missing timing.json, naming it', async () => {
    const workspace = reviewer();
    runAgentEvalPlan(workspace);
    writeTrials(workspace, () => ({}));
    workspace.remove('iteration-1/drops-column/with_agent/fast/trial-2/timing.json');
    await expect(runAgentEvalRecord(workspace)).rejects.toThrow(
      /drops-column:with_agent:fast:2 has no timing.json/,
    );
  });

  it('AC-57: refuses a missing trial directory', async () => {
    const workspace = reviewer();
    runAgentEvalPlan(workspace);
    writeTrials(workspace, () => ({}));
    workspace.remove('iteration-1/clean-migration/main_thread/reasoning/trial-3');
    await expect(runAgentEvalRecord(workspace)).rejects.toThrow(
      /clean-migration:main_thread:reasoning:3 is missing/,
    );
  });

  it('AC-25: the next iteration needs a lever, records it, and a recorded iteration is not overwritten', async () => {
    const workspace = reviewer();
    runAgentEvalPlan(workspace);
    writeTrials(workspace, () => ({ passed: true }));
    await runAgentEvalRecord(workspace);
    await expect(runAgentEvalRecord(workspace)).rejects.toThrow(/already recorded/);
    expect(() => runAgentEvalPlan(workspace)).toThrow(AuthoringRefusal);
    runAgentEvalPlan(workspace, { lever: 'brief' });
    expect(workspace.readJson<{ lever: string }>('iteration-2/plan.json')?.lever).toBe('brief');
  });
});
