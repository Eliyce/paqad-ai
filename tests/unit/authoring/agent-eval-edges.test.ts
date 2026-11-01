import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSpend, recordSpend, planSpend } from '@/authoring/eval/spend.js';
import {
  notAddedLine,
  outcomeFailures,
  runAgentEvalPlan,
  runAgentEvalRecord,
  steadyCacheHitShare,
  unsafeTarEntries,
} from '@/authoring/stages/agent-eval.js';
import { readAuthoringDefects } from '@/authoring/evidence.js';
import { readContractDecisions } from '@/decisions/authoring.js';

import {
  AGENT_INTAKE,
  addCase,
  agentForEval,
  cleanAgentProjects,
  readLoose,
  put,
  writeTrials,
} from '../../shared/agent-pipeline.js';

afterEach(cleanAgentProjects);

const CASE = {
  name: 'a',
  adversarial: false,
  clean_input: true,
  planted_failure: false,
  repo_state: { git_ref: 'HEAD' },
  inputs: ['x'],
  expected: 'y',
};
const NOT_CUT = { max_turns_hit: false, spend_cap_hit: false };

describe('outcome rules (FR-15)', () => {
  it('AC-8: a builder trial that leaves the test command red fails whatever its report says', () => {
    const failures = outcomeFailures({
      grading: { assertions: [], test_command_exit: 1 },
      timing: NOT_CUT,
      agentCase: CASE,
      intake: { class: 'builder', report: { template: 't', max_tokens: 2000 } },
      stageAgent: false,
    });
    expect(failures[0]?.evidence).toBe('the test command exited 1, whatever the report says');
  });

  it('AC-7: a reviewer reporting a defect on the clean input fails', () => {
    const failures = outcomeFailures({
      grading: { assertions: [], reported_defects: 1 },
      timing: NOT_CUT,
      agentCase: CASE,
      intake: { class: 'reviewer', report: { template: 't', max_tokens: 2000 } },
      stageAgent: false,
    });
    expect(failures.map((entry) => entry.text)).toEqual(['stays silent on the clean input']);
  });

  it('AC-40: a report over its maximum fails the format assertion with the overrun in tokens', () => {
    const failures = outcomeFailures({
      grading: { assertions: [], report_tokens: 2150 },
      timing: NOT_CUT,
      agentCase: CASE,
      intake: { class: 'explorer', report: { template: 't', max_tokens: 2000 } },
      stageAgent: false,
    });
    expect(failures[0]).toEqual({
      text: 'the report stays within 2000 tokens',
      evidence: 'the report is 2150 tokens, 150 over its maximum',
    });
  });

  it('AC-27: a stage agent claiming done with a missing artifact fails', () => {
    const failures = outcomeFailures({
      grading: { assertions: [], claimed_done: true, missing_artifacts: ['spec.md'] },
      timing: NOT_CUT,
      agentCase: { ...CASE, planted_failure: true },
      intake: { class: 'verifier', report: { template: 't', max_tokens: 2000 } },
      stageAgent: true,
    });
    expect(failures[0]?.evidence).toBe('it reported done with spec.md missing');
  });

  it('EC-A03, EC-A07: maxTurns or the spend cap cuts a trial off as a failure', () => {
    const failures = outcomeFailures({
      grading: { assertions: [] },
      timing: { max_turns_hit: true, spend_cap_hit: true },
      agentCase: CASE,
      intake: { class: 'explorer', report: { template: 't', max_tokens: 2000 } },
      stageAgent: false,
    });
    expect(failures.map((entry) => entry.text)).toEqual([
      'finishes within maxTurns',
      'finishes within the spend cap',
    ]);
  });
});

describe('record edges', () => {
  function reviewer() {
    const workspace = agentForEval();
    addCase(workspace, 'drops-column', { adversarial: true });
    addCase(workspace, 'clean-migration', { clean_input: true });
    runAgentEvalPlan(workspace);
    return workspace;
  }

  it('AC-57: a trial that hit maxTurns counts as a failure, not a skip', async () => {
    const workspace = reviewer();
    writeTrials(workspace, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: trial.arm === 'with_agent' && trial.trial === 1 ? { max_turns_hit: true } : {},
    }));
    const result = await runAgentEvalRecord(workspace);
    expect(result.ok).toBe(false);
    const benchmark = readLoose(workspace, 'benchmark.json');
    expect(benchmark.analyst.cut_off.length).toBeGreaterThan(0);
    expect(result.lines.at(-1)).toMatch(/start with stopping/);
  });

  it('AC-28, AC-30: the analyst flags tool-use blocks below 1.0, low cache hits and oversize tool results', async () => {
    const workspace = reviewer();
    writeTrials(workspace, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: {
        tool_use_blocks_per_message: 0.5,
        max_tool_result_tokens: 20000,
        requests: [
          { input: 5000, cache_read: 0 },
          { input: 900, cache_read: 100 },
        ],
      },
    }));
    const result = await runAgentEvalRecord(workspace);
    const analyst = readLoose(workspace, 'benchmark.json').analyst;
    expect(analyst.tool_use_blocks_below_floor).toBe(true);
    expect(analyst.cache_hit_share).toBe(0.1);
    expect(analyst.cache_hit_below_min).toBe(true);
    expect(result.lines.filter((line) => line.startsWith('Performance defect:'))).toHaveLength(
      2 + analyst.oversize_tool_results.length,
    );
    expect(result.lines.join('\n')).toMatch(/20000 tokens, above authoring_tool_result_max_tokens/);
  });

  it('AC-50: the steady-state cache-hit share excludes the first request of each trial', () => {
    expect(
      steadyCacheHitShare([
        { input: 1000, cache_read: 0 },
        { input: 200, cache_read: 800 },
      ]),
    ).toBe(0.8);
    expect(steadyCacheHitShare([{ input: 1000, cache_read: 0 }])).toBeNull();
  });

  it('FR-74, AC-37: unavailable usage stays unavailable in the performance fields, never zero', async () => {
    const workspace = reviewer();
    writeTrials(workspace, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: { tokens: 'unavailable', cost_usd: 'unavailable' },
    }));
    await runAgentEvalRecord(workspace);
    const performance = readLoose(workspace, 'benchmark.json').performance;
    expect(performance.tokens_per_task).toEqual({
      value: 'unavailable',
      source: 'subagent-dispatch',
    });
    for (const field of [
      'tokens_per_task',
      'cost_usd',
      'latency_p50_ms',
      'latency_p95_ms',
      'cache_hit_share',
      'tool_calls',
      'tool_use_blocks_per_message',
      'turns',
      'context_utilisation',
    ]) {
      expect(performance[field]).toHaveProperty('source');
    }
    expect(performance.latency_p95_ms).toMatchObject({ measure: 'p95', samples: 12 });
  });

  it('EC-A05, FR-87: queue time is reported apart from latency', async () => {
    const workspace = reviewer();
    writeTrials(workspace, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: { queue_ms: 9000 },
    }));
    await runAgentEvalRecord(workspace);
    const performance = readLoose(workspace, 'benchmark.json').performance;
    expect(performance.queue_ms_median.value).toBe(9000);
    expect(performance.latency_p95_ms.value).toBe(2000);
  });

  it('AC-29: a batched sweep records the requests batched; without batch it says unavailable', async () => {
    const batched = agentForEval();
    addCase(batched, 'a', { adversarial: true, clean_input: true });
    addCase(batched, 'b');
    runAgentEvalPlan(batched, { batchAvailable: true });
    writeTrials(batched, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: { batched: true },
    }));
    await runAgentEvalRecord(batched);
    expect(readLoose(batched, 'benchmark.json').batch).toMatchObject({
      requests_batched: 24,
      fell_back: 0,
    });
    const plain = agentForEval();
    addCase(plain, 'a', { adversarial: true, clean_input: true });
    addCase(plain, 'b');
    runAgentEvalPlan(plain);
    writeTrials(plain, (trial) => ({ passed: trial.arm === 'with_agent' }));
    await runAgentEvalRecord(plain);
    expect(readLoose(plain, 'benchmark.json').batch).toBe('unavailable');
  });

  it('AC-18: records the memory decision with both numbers', async () => {
    const workspace = agentForEval({ ...AGENT_INTAKE, memory: 'candidate' });
    addCase(workspace, 'a', { adversarial: true, clean_input: true });
    addCase(workspace, 'b');
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({ passed: trial.arm !== 'main_thread' }));
    await runAgentEvalRecord(workspace);
    expect(readLoose(workspace, 'benchmark.json').memory).toMatchObject({
      kept: false,
      with_agent_pass_k: 1,
      with_agent_memory_pass_k: 1,
    });
  });

  it('FR-43, AC-25: the loop stops by iteration 3 with a reason and the agent is not added', async () => {
    const workspace = reviewer();
    for (let iteration = 1; iteration <= 3; iteration += 1) {
      if (iteration > 1) runAgentEvalPlan(workspace, { lever: 'stopping' });
      writeTrials(workspace, (trial) => ({ passed: trial.arm !== 'with_agent' }));
      const result = await runAgentEvalRecord(workspace);
      if (result.stopped) {
        expect(result.lines.at(-1)).toBe(notAddedLine('migration-reviewer', 'S5 reliability'));
        expect(result.lines.join('\n')).toMatch(/The loop stopped: /);
        expect(readAuthoringDefects(workspace.projectRoot).at(-1)).toMatchObject({
          gate: 'S5',
          kind: 'agent',
        });
        return;
      }
    }
    throw new Error('the loop did not stop by iteration 3');
  });
});

describe('total spend (FR-41)', () => {
  it('AC-67: raises one packet when real spend reaches the printed worst case, none below it', () => {
    const workspace = agentForEval();
    expect(planSpend(workspace, 'S5-iteration-1', 1)).toBe(1);
    expect(recordSpend(workspace, 'S5-iteration-1', 0.5).raised).toBe(false);
    expect(readContractDecisions(workspace.projectRoot)).toHaveLength(0);
    const reached = recordSpend(workspace, 'S5-iteration-1', 1);
    expect(reached.raised).toBe(true);
    expect(recordSpend(workspace, 'S5-iteration-1', 1.2).raised).toBe(false);
    expect(readContractDecisions(workspace.projectRoot)).toHaveLength(1);
    expect(readSpend(workspace).decision).toBe(reached.decision);
  });
});

describe('fixture tarballs (FR-59)', () => {
  it('refuses absolute paths, .. segments and escaping symlinks before extraction', () => {
    expect(
      unsafeTarEntries([
        { path: '/etc/passwd', type: 'file' },
        { path: 'a/../../b', type: 'file' },
        { path: 'link', type: 'symlink', link: '../../outside' },
        { path: 'ok/file', type: 'file' },
        { path: 'ok/link', type: 'symlink', link: 'file' },
      ]),
    ).toEqual([
      '/etc/passwd is an absolute path or holds a .. segment',
      'a/../../b is an absolute path or holds a .. segment',
      'link is a symlink pointing outside the trial directory',
    ]);
  });

  it('refuses a case whose tarball holds an escaping symlink', () => {
    const workspace = agentForEval();
    const staging = join(workspace.projectRoot, 'staging');
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'a.txt'), 'a');
    symlinkSync('../../../etc/passwd', join(staging, 'evil'));
    addCase(workspace, 'a', {
      adversarial: true,
      clean_input: true,
      repo_state: { fixture_tarball: 'repo.tar' },
    });
    addCase(workspace, 'b');
    execFileSync('tar', [
      '-cf',
      workspace.path('evals/a/repo.tar'),
      '-C',
      staging,
      'a.txt',
      'evil',
    ]);
    expect(() => runAgentEvalPlan(workspace)).toThrow(/evil is a symlink pointing outside/);
  });

  it('INV-4: refuses trials for an agent whose risky power has no resolved packet', () => {
    const workspace = agentForEval();
    put(workspace.projectRoot, 'x', '');
    workspace.write(
      'draft/migration-reviewer.md',
      (workspace.read('draft/migration-reviewer.md') ?? '').replace(
        'tools: Read, Grep, Glob',
        'tools: Read, WebFetch',
      ),
    );
    addCase(workspace, 'a', { adversarial: true, clean_input: true });
    addCase(workspace, 'b');
    expect(() => runAgentEvalPlan(workspace)).toThrow(
      /asks for WebFetch with no resolved authoring.agent_permission/,
    );
  });
});
