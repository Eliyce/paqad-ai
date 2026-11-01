import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runAgentEvalPlan, runAgentEvalRecord } from '@/authoring/stages/agent-eval.js';
import { MODE_FILE, type AgentWorkspace } from '@/authoring/workspace.js';

import {
  addCase,
  AGENT_INTAKE,
  AGENT_NAME,
  agentForEval,
  cleanAgentProjects,
  put,
  readLoose,
  writeTrials,
} from '../../shared/agent-pipeline.js';

afterEach(cleanAgentProjects);

function twoCases(workspace: AgentWorkspace): void {
  addCase(workspace, 'a', { adversarial: true, clean_input: true });
  addCase(workspace, 'b');
}

function firstTrialDir(workspace: AgentWorkspace): string {
  const trials = workspace.readJson<Array<{ workdir: string }>>('iteration-1/trials.json')!;
  return trials[0]!.workdir.slice(workspace.rel.length + 1);
}

describe('S5 plan refusals (FR-15)', () => {
  it('AC-6: refuses a case folder with no case.yaml or no prompt.md, and skips a stray file', () => {
    const noYaml = agentForEval();
    twoCases(noYaml);
    noYaml.write('evals/README.md', 'notes\n');
    noYaml.write('evals/c/prompt.md', 'Review c.\n');
    expect(() => runAgentEvalPlan(noYaml)).toThrow(/The case c has no case.yaml/u);

    const noPrompt = agentForEval();
    twoCases(noPrompt);
    noPrompt.remove('evals/b/prompt.md');
    expect(() => runAgentEvalPlan(noPrompt)).toThrow(/The case b has no prompt.md/u);
  });

  it('AC-6: names every missing field of a case', () => {
    const workspace = agentForEval();
    twoCases(workspace);
    workspace.write('evals/b/case.yaml', '');
    expect(() => runAgentEvalPlan(workspace)).toThrow(
      /is missing repo_state \(git_ref or fixture_tarball\), inputs, expected\./u,
    );
  });

  it('refuses before cases are read when intake.yaml is missing', () => {
    const workspace = agentForEval();
    twoCases(workspace);
    workspace.remove('intake.yaml');
    expect(() => runAgentEvalPlan(workspace)).toThrow();
  });

  it('AC-27: a stage agent needs a planted-failure case', () => {
    const workspace = agentForEval({ ...AGENT_INTAKE, class: 'verifier' });
    workspace.writeJson('draft-source.json', {
      file: `runtime/templates/stage-agents/${AGENT_NAME}.md`,
      hook_scripts: [],
    });
    twoCases(workspace);
    expect(() => runAgentEvalPlan(workspace)).toThrow(/needs a planted-failure case/u);
  });

  it('FR-59: refuses a case whose fixture tarball is missing and lists directories as safe', () => {
    const missing = agentForEval();
    addCase(missing, 'a', {
      adversarial: true,
      clean_input: true,
      repo_state: { fixture_tarball: 'repo.tar' },
    });
    addCase(missing, 'b');
    expect(() => runAgentEvalPlan(missing)).toThrow(/The fixture tarball repo.tar of the case a/u);

    const safe = agentForEval();
    const staging = join(safe.projectRoot, 'staging');
    mkdirSync(join(staging, 'src'), { recursive: true });
    writeFileSync(join(staging, 'src', 'a.txt'), 'a');
    addCase(safe, 'a', {
      adversarial: true,
      clean_input: true,
      repo_state: { fixture_tarball: 'repo.tar' },
    });
    addCase(safe, 'b');
    execFileSync('tar', ['-cf', safe.path('evals/a/repo.tar'), '-C', staging, 'src']);
    expect(runAgentEvalPlan(safe).ok).toBe(true);
  });

  it('FR-43: an unknown lever is a usage error and the loop stops planning past the iteration cap', async () => {
    const workspace = agentForEval();
    twoCases(workspace);
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({ passed: trial.arm !== 'with_agent' }));
    await runAgentEvalRecord(workspace);
    expect(() => runAgentEvalPlan(workspace, { lever: 'louder' })).toThrow(
      /--lever must be one of/u,
    );

    const capped = agentForEval();
    put(capped.projectRoot, '.paqad/.config', 'authoring_max_iterations=1\n');
    twoCases(capped);
    runAgentEvalPlan(capped);
    writeTrials(capped, (trial) => ({ passed: trial.arm !== 'with_agent' }));
    await runAgentEvalRecord(capped);
    expect(() => runAgentEvalPlan(capped, { lever: 'brief' })).toThrow(
      /The S5 loop stops at 1 iterations/u,
    );
  });
});

describe('S5 record refusals (FR-15)', () => {
  function planned(): AgentWorkspace {
    const workspace = agentForEval();
    twoCases(workspace);
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({ passed: trial.arm === 'with_agent' }));
    return workspace;
  }

  it('refuses with no planned iteration', async () => {
    const workspace = agentForEval();
    await expect(runAgentEvalRecord(workspace)).rejects.toThrow(/There is no planned iteration/u);
  });

  it('refuses a trial with no outputs folder', async () => {
    const workspace = planned();
    workspace.remove(`${firstTrialDir(workspace)}/outputs`);
    await expect(runAgentEvalRecord(workspace)).rejects.toThrow(/has no outputs\//u);
  });

  it('FR-74: refuses a timing.json that leaves out duration_ms and max_turns_hit', async () => {
    const workspace = planned();
    workspace.writeJson(`${firstTrialDir(workspace)}/timing.json`, {
      tokens: 1,
      tool_calls: 1,
      turns: 1,
      cost_usd: 0,
    });
    await expect(runAgentEvalRecord(workspace)).rejects.toThrow(
      /timing.json is missing .*duration_ms, max_turns_hit/u,
    );
  });

  it('refuses a missing timing.json, an empty grading.json and an assertion with no evidence', async () => {
    const noTiming = planned();
    noTiming.remove(`${firstTrialDir(noTiming)}/timing.json`);
    await expect(runAgentEvalRecord(noTiming)).rejects.toThrow(/has no timing.json/u);

    const noAssertions = planned();
    noAssertions.writeJson(`${firstTrialDir(noAssertions)}/grading.json`, { assertions: [] });
    await expect(runAgentEvalRecord(noAssertions)).rejects.toThrow(
      /has no grading.json with assertions/u,
    );

    const unevidenced = planned();
    unevidenced.writeJson(`${firstTrialDir(unevidenced)}/grading.json`, {
      assertions: [{ text: 'names the drop', passed: true, evidence: ' ' }],
    });
    await expect(runAgentEvalRecord(unevidenced)).rejects.toThrow(
      /cites no evidence for: names the drop/u,
    );
  });

  it('FR-74: a trial form named in timing.json is kept on the benchmark', async () => {
    const workspace = agentForEval();
    twoCases(workspace);
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: { form: 'plugin-agent', requests: [{ input: 10 }, { input: 0, cache_read: 0 }] },
    }));
    const result = await runAgentEvalRecord(workspace);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(readLoose(workspace, 'benchmark.json').gate).toBeDefined();
  });
});

describe('S5 record judgement inputs', () => {
  it('AC-41: an edited agent is judged against old_agent with the comparison preferences', async () => {
    const workspace = agentForEval();
    workspace.writeJson(MODE_FILE, { entry: 'improve' });
    twoCases(workspace);
    runAgentEvalPlan(workspace);
    writeTrials(workspace, () => ({ passed: true }));
    workspace.writeJson('iteration-1/comparison.json', {
      cases: [{ preferred: 'new' }, { preferred: 'old' }, { preferred: 'neither' }],
    });
    const result = await runAgentEvalRecord(workspace);
    expect(result.lines[0]).toContain('against old_agent');
    expect(readLoose(workspace, 'benchmark.json').baseline_arm).toBe('old_agent');
  });

  it('AC-24: a dispatched agent that passes is told it skips S6', async () => {
    const workspace = agentForEval({ ...AGENT_INTAKE, invocation: 'dispatched' });
    twoCases(workspace);
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({ passed: trial.arm === 'with_agent' }));
    const result = await runAgentEvalRecord(workspace);
    expect(result.ok).toBe(true);
    expect(result.lines.at(-1)).toContain('(dispatched agents skip S6)');
  });

  it('AC-10: a parallel agent faster than the main thread counts the wall-time gain', async () => {
    const workspace = agentForEval({ ...AGENT_INTAKE, parallel: true });
    twoCases(workspace);
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({
      passed: true,
      timing: { duration_ms: trial.arm === 'with_agent' ? 1000 : 9000 },
    }));
    const result = await runAgentEvalRecord(workspace);
    expect(result.lines[0]).toMatch(/^Iteration 1: pass\^3/u);
  });

  it('AC-67: trials that spend past the worst case raise the spend packet in the output', async () => {
    const workspace = agentForEval();
    twoCases(workspace);
    runAgentEvalPlan(workspace);
    writeTrials(workspace, (trial) => ({
      passed: trial.arm === 'with_agent',
      timing: { cost_usd: 1000 },
    }));
    const result = await runAgentEvalRecord(workspace);
    expect(result.lines.join('\n')).toMatch(/Spend reached the worst case of \$/u);
  });
});
