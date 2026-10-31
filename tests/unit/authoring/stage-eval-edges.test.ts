import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEvalPlan, runEvalRecord, type PlannedRun } from '@/authoring/stages/eval.js';
import { runTriggerPlan, runTriggerRecord } from '@/authoring/stages/trigger.js';
import { renderGateMarkdown, SkillWorkspace } from '@/authoring/workspace.js';

const NAME = 'processing-invoices';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-eval-edges-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  writeFileSync(
    join(root, '.paqad/.config'),
    'model_fast=fast-m\nmodel_reasoning=strong-m\nauthoring_runs_per_arm=1\nauthoring_max_iterations=2\n',
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function host(adapter: string): void {
  writeFileSync(join(root, '.paqad/onboarding-manifest.json'), JSON.stringify({ adapter }));
}

function atS5(verifiability = 'objective'): SkillWorkspace {
  const workspace = new SkillWorkspace(root, NAME);
  for (const file of ['justification.md', 'overlap.md', 'trace.md']) {
    workspace.write(file, renderGateMarkdown({ gate: 'passed' }, 'x'));
  }
  workspace.write('intake.yaml', `purpose: x\nverifiability: ${verifiability}\n`);
  workspace.writeJson('script-tests.json', { gate: 'passed' });
  workspace.write(
    `draft/${NAME}/SKILL.md`,
    `---\nname: ${NAME}\ndescription: Parses invoices. Use when one arrives.\n---\n# Body\n`,
  );
  workspace.write('evals/happy/prompt.md', 'Book this invoice.\n');
  workspace.write('evals/edge/prompt.md', 'Book this credit note.\n');
  workspace.write('evals/edge/case.yaml', 'edge: true\n');
  return workspace;
}

function planned(workspace: SkillWorkspace, iteration = 1): PlannedRun[] {
  return JSON.parse(
    readFileSync(workspace.path(`iteration-${iteration}/runs.json`), 'utf8'),
  ) as PlannedRun[];
}

function base(workspace: SkillWorkspace, run: PlannedRun): string {
  return run.workdir.replace(`${workspace.rel}/`, '');
}

function writeRun(
  workspace: SkillWorkspace,
  run: PlannedRun,
  passed: boolean,
  timing: Record<string, unknown> = {},
  grading: Record<string, unknown> | null = null,
): void {
  const dir = base(workspace, run);
  workspace.write(`${dir}/outputs/out.json`, '{}');
  workspace.writeJson(
    `${dir}/grading.json`,
    grading ?? { expectations: [{ text: 'writes ledger JSON', passed }] },
  );
  workspace.writeJson(`${dir}/timing.json`, {
    model: run.model,
    duration_ms: 1000,
    tokens: 1000,
    ...timing,
  });
}

describe('S5 case discovery', () => {
  it('refuses a case folder without prompt.md and skips loose files', () => {
    host('codex-cli');
    const workspace = atS5();
    workspace.write('evals/notes.txt', 'not a case');
    workspace.write('evals/broken/case.yaml', 'edge: false\n');
    expect(() => runEvalPlan(workspace)).toThrow('The case broken has no prompt.md.');
  });

  it('refuses fewer than two cases', () => {
    host('codex-cli');
    const workspace = atS5();
    workspace.remove('evals/happy');
    expect(() => runEvalPlan(workspace)).toThrow('S5 needs at least 2 cases');
  });

  it('adds legacy evals.json cases by name or id, skipping blanks and duplicates', () => {
    host('codex-cli');
    const workspace = atS5();
    workspace.writeJson('evals/evals.json', {
      evals: [{ name: 'legacy' }, { id: 'by-id', edge: true }, {}, { name: 'happy' }],
    });
    runEvalPlan(workspace);
    const plan = JSON.parse(readFileSync(workspace.path('iteration-1/plan.json'), 'utf8'));
    expect(plan.cases.map((entry: { name: string }) => entry.name)).toEqual([
      'edge',
      'happy',
      'legacy',
      'by-id',
    ]);
  });

  it('improve mode on Claude Code dispatches subagents to compare against the snapshot', () => {
    host('claude-code');
    const workspace = atS5();
    workspace.writeJson('mode.json', { entry: 'improve', source: '.claude/skills/x' });
    const result = runEvalPlan(workspace, { probe: () => '2.1.302' });
    expect(result.lines[0]).toContain(
      'subagent-dispatch (improve mode compares against the snapshot)',
    );
  });
});

describe('S5 record on claude plugin eval', () => {
  function plugin(workspace: SkillWorkspace, fast: unknown, reasoning: unknown = fast): void {
    workspace.writeJson('iteration-1/fast.json', fast);
    workspace.writeJson('iteration-1/reasoning.json', reasoning);
  }

  const graders = [{ name: 'g', passed: true, scored: true }];

  it('refuses a missing tier file, a case with no name and a case with no runs', async () => {
    host('claude-code');
    const workspace = atS5();
    runEvalPlan(workspace, { probe: () => '2.1.302' });
    await expect(runEvalRecord(workspace)).rejects.toThrow('fast.json is missing or not JSON');
    plugin(workspace, { cases: [{ runs: [] }] });
    await expect(runEvalRecord(workspace)).rejects.toThrow('cases[0] is missing name.');
    plugin(workspace, { cases: [{ name: 'happy' }] });
    await expect(runEvalRecord(workspace)).rejects.toThrow(
      'cases[0] is missing runs[] (or arms.with[] and arms.without[]).',
    );
  });

  it('refuses arms that are not lists or runs without graders or duration', async () => {
    host('claude-code');
    const workspace = atS5();
    runEvalPlan(workspace, { probe: () => '2.1.302' });
    plugin(workspace, { cases: [{ name: 'happy', arms: { with: 'x' } }] });
    await expect(runEvalRecord(workspace)).rejects.toThrow('arms.with is not a list of runs.');
    plugin(workspace, { cases: [{ name: 'happy', arms: { with: [null] } }] });
    await expect(runEvalRecord(workspace)).rejects.toThrow('arms.with[0] is missing graders[].');
    plugin(workspace, { cases: [{ name: 'happy', arms: { with: [{ graders }] } }] });
    await expect(runEvalRecord(workspace)).rejects.toThrow(
      'arms.with[0] is missing durationSeconds.',
    );
  });

  it('records a with-only sweep with no cost reported', async () => {
    host('claude-code');
    const workspace = atS5();
    runEvalPlan(workspace, { probe: () => '2.1.302' });
    const run = { graders, durationSeconds: 3, error: null };
    plugin(workspace, {
      cases: [{ name: 'happy', arms: { with: [run], without: [{ ...run, graders: [] }] } }],
    });
    const result = await runEvalRecord(workspace);
    expect(result.lines[0]).toContain('Iteration 1');
  });
});

describe('S5 record on subagent dispatch', () => {
  it('reads token objects, run failures, costs and cache shares', async () => {
    host('codex-cli');
    const workspace = atS5();
    runEvalPlan(workspace);
    const runs = planned(workspace);
    runs.forEach((run, index) =>
      writeRun(workspace, run, true, {
        tokens: { input: 900, output: 100 },
        cost_usd: 0.01,
        cache_hit_share: 0.8,
        max_tool_result_tokens: 50,
        ...(index === 0 ? { exit_code: 1 } : {}),
        ...(index === 1 ? { capped: true } : {}),
      }),
    );
    workspace.write(`${base(workspace, runs[2]!).replace(/run-1$/u, 'notes')}/x`, 'x');
    const result = await runEvalRecord(workspace);
    expect(result.lines[0]).toContain('Iteration 1');
    expect(readFileSync(join(root, '.paqad/ledger/authoring/defects.jsonl'), 'utf8')).toContain(
      '"gate":"S5"',
    );
  });

  it('refuses timing without model, duration or tokens, and grading without expectations', async () => {
    host('codex-cli');
    const workspace = atS5();
    runEvalPlan(workspace);
    const runs = planned(workspace);
    for (const run of runs) writeRun(workspace, run, true);
    writeRun(workspace, runs[0]!, true, { model: 1, duration_ms: 'x', tokens: {} });
    await expect(runEvalRecord(workspace)).rejects.toThrow(
      'is missing model, duration_ms, tokens.',
    );
    writeRun(workspace, runs[0]!, true, {}, { expectations: 'none' });
    await expect(runEvalRecord(workspace)).rejects.toThrow('is missing expectations[].');
  });

  it('counts an assertion with no verdict as unverifiable', async () => {
    host('codex-cli');
    const workspace = atS5();
    runEvalPlan(workspace);
    for (const run of planned(workspace)) {
      writeRun(
        workspace,
        run,
        true,
        {},
        { expectations: [{ passed: 'maybe' }, { text: 'ok', passed: true }] },
      );
    }
    expect((await runEvalRecord(workspace)).lines[0]).toContain('Iteration 1');
  });

  it('refuses a record with no plan, a second record of one iteration, and a tier with no runs', async () => {
    host('codex-cli');
    const workspace = atS5();
    await expect(runEvalRecord(workspace)).rejects.toThrow('There is no planned iteration.');
    runEvalPlan(workspace);
    for (const run of planned(workspace)) writeRun(workspace, run, true);
    await runEvalRecord(workspace);
    await expect(runEvalRecord(workspace)).rejects.toThrow('Iteration 1 is already recorded.');
    runEvalPlan(workspace);
    const runs = planned(workspace, 2);
    workspace.writeJson(
      'iteration-2/runs.json',
      runs.filter((run) => run.tier === 'fast'),
    );
    const plan = JSON.parse(readFileSync(workspace.path('iteration-2/plan.json'), 'utf8'));
    for (const run of runs.filter((entry) => entry.tier === 'fast')) writeRun(workspace, run, true);
    workspace.writeJson('iteration-2/plan.json', plan);
    await expect(runEvalRecord(workspace)).rejects.toThrow('has no runs on the reasoning tier.');
  });

  it('a subjective skill needs the comparator and passes only when it prefers the new version', async () => {
    host('codex-cli');
    const workspace = atS5('subjective');
    runEvalPlan(workspace);
    for (const run of planned(workspace)) writeRun(workspace, run, true);
    await expect(runEvalRecord(workspace)).rejects.toThrow('comparison.json');
    workspace.writeJson('iteration-1/comparison.json', {
      cases: [{ preferred: 'new' }, { preferred: 'old' }, { preferred: 'x' }],
    });
    const result = await runEvalRecord(workspace);
    expect(result.ok).toBe(false);
  });

  it('stops the loop at the iteration cap and records the defect', async () => {
    host('codex-cli');
    const workspace = atS5();
    for (let iteration = 1; iteration <= 2; iteration += 1) {
      runEvalPlan(workspace);
      for (const run of planned(workspace, iteration)) writeRun(workspace, run, false);
    }
    const first = JSON.parse(readFileSync(workspace.path('iteration-2/runs.json'), 'utf8'));
    expect(first.length).toBeGreaterThan(0);
    const result = await runEvalRecord(workspace);
    expect(result.ok).toBe(false);
  });
});

describe('S6 trigger edges', () => {
  function atS6(): SkillWorkspace {
    host('codex-cli');
    const workspace = atS5();
    workspace.writeJson('benchmark.json', { gate: 'passed' });
    return workspace;
  }

  const queries = Array.from({ length: 10 }, (_, index) => ({
    id: `id-${index}`,
    query: `query ${index}`,
    should_trigger: index < 5,
  }));

  function results(description: string, fired: (index: number) => boolean) {
    return {
      description,
      results: queries.flatMap((query, index) =>
        [1, 2, 3].map((run) => ({ id: query.id, run, fired: fired(index) })),
      ),
    };
  }

  it('refuses a queries file that is not a list, misses fields or lacks near-misses', () => {
    const workspace = atS6();
    expect(() => runTriggerPlan(workspace, '{}')).toThrow('must be a JSON array');
    expect(() => runTriggerPlan(workspace, '[{"query":"q"}]')).toThrow(
      'Query 1 is missing query or should_trigger.',
    );
    expect(() =>
      runTriggerPlan(workspace, JSON.stringify([{ query: 'q', should_trigger: true }])),
    ).toThrow('near-misses');
  });

  it('records batch off when the batch mode is off and keeps given ids', () => {
    const workspace = atS6();
    writeFileSync(join(root, '.paqad/.config'), 'authoring_batch_mode=off\n');
    runTriggerPlan(workspace, JSON.stringify(queries));
    const evalFile = JSON.parse(readFileSync(workspace.path('trigger-eval.json'), 'utf8'));
    expect(evalFile.batch).toBe('off');
    expect(evalFile.queries[0].id).toBe('id-0');
  });

  it('refuses a record before the plan, with no iterations, a bad iteration or too many', () => {
    const workspace = atS6();
    expect(() => runTriggerRecord(workspace, '{"iterations":[]}')).toThrow(
      'trigger-eval.json is missing',
    );
    runTriggerPlan(workspace, JSON.stringify(queries));
    expect(() => runTriggerRecord(workspace, '{"iterations":[]}')).toThrow(
      'The results file is missing iterations[].',
    );
    expect(() => runTriggerRecord(workspace, '{"iterations":[{"results":[]}]}')).toThrow(
      'iterations[0] is missing description or results[].',
    );
    const many = Array.from({ length: 6 }, () => results('d. Use when asked.', (i) => i < 5));
    expect(() => runTriggerRecord(workspace, JSON.stringify({ iterations: many }))).toThrow(
      'at most 5 description iterations',
    );
  });

  it('fails on a low validation score and on a sweep over the cost cap', () => {
    const workspace = atS6();
    runTriggerPlan(workspace, JSON.stringify(queries));
    const record = runTriggerRecord(
      workspace,
      JSON.stringify({
        iterations: [{ iteration: 7, ...results('Never fires. Use when asked.', () => false) }],
        cost_usd: 99,
      }),
    );
    expect(record.ok).toBe(false);
    const file = JSON.parse(readFileSync(workspace.path('trigger-results.json'), 'utf8'));
    expect(file.partial).toBe(true);
    expect(file.reason).toContain('over the cap');
  });

  it('fails when every description is discarded', () => {
    const workspace = atS6();
    runTriggerPlan(workspace, JSON.stringify(queries));
    const record = runTriggerRecord(
      workspace,
      JSON.stringify({ iterations: [results('x'.repeat(1025), (i) => i < 5)] }),
    );
    expect(record.ok).toBe(false);
    expect(record.lines.at(-1)).toContain('every iteration was discarded');
  });
});
