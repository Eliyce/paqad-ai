import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_REFUSALS,
  agentRefusalLine,
  median,
  reasonBacking,
  runAgentJustify,
  taskSection,
  type AgentBaselineRun,
} from '@/authoring/stages/agent-justify.js';
import { runAgentIntake } from '@/authoring/stages/agent-intake.js';
import {
  AGENT_WORKSPACE_ROOT,
  AgentWorkspace,
  AuthoringRefusal,
  MODE_FILE,
  stageState,
  stageById,
  AGENT_STAGES,
} from '@/authoring/workspace.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-justify-'));
  roots.push(root);
  return root;
}

function run(overrides: Partial<AgentBaselineRun> = {}, index = 1): AgentBaselineRun {
  return {
    run: index,
    passed: true,
    note: 'ok',
    tokens: 10000,
    duration_ms: 30000,
    verbose_tokens_in_main: 6000,
    ...overrides,
  };
}

function baseline(workspace: AgentWorkspace, runs: AgentBaselineRun[]): void {
  mkdirSync(workspace.path('baseline'), { recursive: true });
  writeFileSync(workspace.path('baseline/verdicts.json'), JSON.stringify(runs));
  for (const entry of runs) writeFileSync(workspace.path(`baseline/run-${entry.run}.md`), 'x');
}

const TASK = '# Task\n\nRun the test suite and report failures.\n';

describe('agent justify (S0)', () => {
  it('AC-24: a refusal case prints the line naming the better home and creates no workspace', () => {
    for (const kind of AGENT_REFUSALS) {
      const root = project();
      const workspace = new AgentWorkspace(root, 'test-runner');
      const result = runAgentJustify(workspace, { refuse: kind });
      expect(result.ok).toBe(false);
      expect(result.stopped).toBe(true);
      expect(result.lines[0]).toBe(agentRefusalLine(kind));
      expect(result.lines[1]).toMatch(/do not write it/);
      expect(existsSync(join(root, AGENT_WORKSPACE_ROOT))).toBe(false);
    }
  });

  it('AC-24: the skill-or-hook refusal hands the planned file to the Skill Orchestrator', () => {
    const result = runAgentJustify(new AgentWorkspace(project(), 'x-runner'), {
      refuse: 'skill-or-hook',
    });
    expect(result.lines[0]).toBe(
      "A skill (or a hook) does this inline at lower cost. I'll start the Skill Orchestrator instead.",
    );
    expect(result.lines[1]).toMatch(/handed to the Skill Orchestrator/);
  });

  it('AC-24: naming none of the S0 reasons is refused with the main conversation as the home', () => {
    const root = project();
    const result = runAgentJustify(new AgentWorkspace(root, 'test-runner'), {});
    expect(result.stopped).toBe(true);
    expect(result.lines[0]).toMatch(/main conversation is the better home/);
    expect(existsSync(join(root, AGENT_WORKSPACE_ROOT))).toBe(false);
  });

  it('refuses an unknown reason or refusal key as a usage error', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    expect(() => runAgentJustify(workspace, { reason: 'faster' })).toThrow(AuthoringRefusal);
    expect(() => runAgentJustify(workspace, { refuse: 'nope' })).toThrow(/--refuse must be/);
    expect(() => runAgentJustify(workspace, { reason: 'parallel' })).toThrow(/--task-file/);
  });

  it('refuses without the three baseline runs, naming the producer step', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    expect(() => runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK })).toThrow(
      /verdicts.json is missing/,
    );
    baseline(workspace, [run(), run({}, 2)]);
    expect(() => runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK })).toThrow(
      /exactly 3 entries/,
    );
    writeFileSync(
      workspace.path('baseline/verdicts.json'),
      JSON.stringify([run(), run({}, 2), { run: 3, passed: true, note: 'x' }]),
    );
    expect(() => runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK })).toThrow(
      /entry 3 is missing tokens, duration_ms, verbose_tokens_in_main/,
    );
  });

  it('passes verbose-output when the baseline shows verbose tokens in the main context', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    baseline(workspace, [run(), run({}, 2), run({}, 3)]);
    const result = runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK });
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toMatch(/An agent is justified \(verbose-output\)/);
    expect(stageState(workspace, stageById('S0', AGENT_STAGES)).state).toBe('passed');
    expect(workspace.read('justification.md')).toContain('verbose_tokens_in_main_median: 6000');
    expect(workspace.read('task.md')).toBe(TASK);
  });

  it('a reason the baseline does not back is refused and writes no justification', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    baseline(workspace, [
      run({ verbose_tokens_in_main: 0 }),
      run({ verbose_tokens_in_main: 0 }, 2),
      run({ verbose_tokens_in_main: 0 }, 3),
    ]);
    const result = runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK });
    expect(result.stopped).toBe(true);
    expect(result.lines[0]).toMatch(/does not back the reason verbose-output/);
    expect(workspace.exists('justification.md')).toBe(false);
  });

  it('AC-1: S1 refuses while justification.md has not passed, naming paqad-ai agent justify', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    expect(() => runAgentIntake(workspace, 'job: x\n')).toThrow(
      /S0 justify has not passed .*justification\.md.*paqad-ai agent justify test-runner/,
    );
  });

  it('skips S0 in improve mode', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    workspace.writeJson(MODE_FILE, { entry: 'improve' });
    expect(runAgentJustify(workspace, {}).lines[0]).toMatch(/S0 is skipped/);
  });
});

describe('reasonBacking', () => {
  const runs = [run(), run({}, 2), run({ passed: false }, 3)];

  it('backs each reason from the baseline or the task file', () => {
    expect(reasonBacking('summarisable', runs, TASK, 2000).backed).toBe(true);
    expect(reasonBacking('summarisable', runs, TASK, 20000).backed).toBe(false);
    expect(reasonBacking('cheaper-model', runs, TASK, 2000).backed).toBe(true);
    expect(
      reasonBacking(
        'cheaper-model',
        [run({ passed: false }), run({ passed: false }, 2), run({}, 3)],
        TASK,
        2000,
      ).backed,
    ).toBe(false);
    expect(reasonBacking('restriction', runs, TASK, 2000).backed).toBe(false);
    expect(
      reasonBacking('restriction', runs, `${TASK}\n## Restriction\n\nRead only.\n`, 2000).evidence,
    ).toBe('the task names the restriction: Read only.');
    expect(
      reasonBacking('recurring-role', runs, '## Recurs\n\nEvery release.\n', 2000).backed,
    ).toBe(true);
    expect(reasonBacking('parallel', runs, '## Pieces\n- a\n- b\n', 2000).backed).toBe(false);
    expect(reasonBacking('parallel', runs, '## Pieces\n- a\n- b\n- c\n', 2000).backed).toBe(true);
    const files = Array.from({ length: 10 }, (_, i) => `- f${i}.ts`).join('\n');
    expect(reasonBacking('parallel', runs, `## Files\n${files}\n`, 2000).backed).toBe(true);
  });

  it('reads sections and medians deterministically', () => {
    expect(taskSection('## A\nx\n## B\ny\n', 'B')).toEqual(['y']);
    expect(taskSection('## A\nx\n', 'C')).toEqual([]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('agent justify (S0) baseline shapes', () => {
  it('names every missing field of a null entry, a bad passed and a missing note', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    baseline(workspace, [run(), run({}, 2), run({}, 3)]);
    writeFileSync(
      workspace.path('baseline/verdicts.json'),
      JSON.stringify([null, run({}, 2), run({}, 3)]),
    );
    expect(() => runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK })).toThrow(
      /entry 1 is missing run, passed, note, run, tokens, duration_ms, verbose_tokens_in_main/u,
    );
    const odd: Record<string, unknown> = { ...run({}, 2), passed: 'yes' };
    delete odd.note;
    writeFileSync(
      workspace.path('baseline/verdicts.json'),
      JSON.stringify([run(), odd, run({}, 3)]),
    );
    expect(() => runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK })).toThrow(
      /entry 2 is missing passed, note\./u,
    );
  });

  it('refuses a verdicts file that is not JSON and a missing run file', () => {
    const workspace = new AgentWorkspace(project(), 'test-runner');
    baseline(workspace, [run(), run({}, 2), run({}, 3)]);
    rmSync(workspace.path('baseline/run-2.md'));
    expect(() => runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK })).toThrow(
      /baseline\/run-2.md is missing/u,
    );
    writeFileSync(workspace.path('baseline/verdicts.json'), '{nope');
    expect(() => runAgentJustify(workspace, { reason: 'verbose-output', taskText: TASK })).toThrow(
      /verdicts.json is not valid JSON/u,
    );
  });

  it('verbose-output with zero baseline tokens is not backed', () => {
    const zero = [run({ tokens: 0, verbose_tokens_in_main: 0 }), run({ tokens: 0 }, 2)];
    expect(reasonBacking('verbose-output', zero, TASK, 2000).backed).toBe(false);
    expect(taskSection('## A\nx\n# Next\ny\n', 'A')).toEqual(['x']);
  });
});
