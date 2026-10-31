import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEvalPlan, runEvalRecord, type PlannedRun } from '@/authoring/stages/eval.js';
import { skillStatus } from '@/authoring/stages/status.js';
import { runTriggerPlan, runTriggerRecord } from '@/authoring/stages/trigger.js';
import { renderGateMarkdown, SkillWorkspace } from '@/authoring/workspace.js';
import { readContractDecisions } from '@/decisions/authoring.js';

const NAME = 'processing-invoices';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-eval-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  writeFileSync(
    join(root, '.paqad/.config'),
    'model_fast=fast-m\nmodel_reasoning=strong-m\nauthoring_runs_per_arm=1\n',
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function host(adapter: string): void {
  writeFileSync(join(root, '.paqad/onboarding-manifest.json'), JSON.stringify({ adapter }));
}

function workspaceAtS5(): SkillWorkspace {
  const workspace = new SkillWorkspace(root, NAME);
  for (const file of ['justification.md', 'overlap.md', 'trace.md']) {
    workspace.write(file, renderGateMarkdown({ gate: 'passed' }, 'x'));
  }
  workspace.write('intake.yaml', 'purpose: x\nverifiability: objective\n');
  workspace.writeJson('script-tests.json', { gate: 'passed' });
  workspace.write(
    `draft/${NAME}/SKILL.md`,
    `---\nname: ${NAME}\ndescription: Parses invoices. Use when one arrives.\n---\n# Body\n`,
  );
  workspace.write('evals/happy/prompt.md', 'Book this invoice.\n');
  workspace.write('evals/edge/prompt.md', 'Book this credit note.\n');
  workspace.write('evals/edge/case.yaml', 'description: a credit note\nedge: true\n');
  return workspace;
}

function writeRun(
  workspace: SkillWorkspace,
  planned: PlannedRun,
  passed: boolean,
  tokens: number | null = 1000,
): void {
  const base = planned.workdir.replace(`${workspace.rel}/`, '');
  workspace.write(`${base}/outputs/out.json`, '{}');
  workspace.writeJson(`${base}/grading.json`, {
    expectations: [{ text: 'writes ledger JSON', passed }],
  });
  workspace.writeJson(`${base}/timing.json`, {
    model: planned.model,
    duration_ms: 1000,
    ...(tokens === null ? {} : { tokens }),
  });
}

describe('S5 eval plan', () => {
  it('refuses fewer than two cases or no edge case', () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    workspace.write('evals/edge/case.yaml', 'edge: false\n');
    expect(() => runEvalPlan(workspace)).toThrow('at least one edge case');
  });

  it('FR-28, FR-32: subagent dispatch writes runs.json and states the run count and worst-case spend', () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    const result = runEvalPlan(workspace);
    expect(result.lines[0]).toBe(
      'Iteration 1 on subagent-dispatch (codex-cli can dispatch subagents): 8 runs, worst-case spend $10.',
    );
    const runs = JSON.parse(
      readFileSync(workspace.path('iteration-1/runs.json'), 'utf8'),
    ) as PlannedRun[];
    expect(runs).toHaveLength(8);
    expect(new Set(runs.map((entry) => entry.model))).toEqual(new Set(['fast-m', 'strong-m']));
  });

  it('prints one claude plugin eval command per tier with the spend cap', () => {
    host('claude-code');
    const workspace = workspaceAtS5();
    const result = runEvalPlan(workspace, { probe: () => '2.1.302' });
    expect(result.lines[1]).toBe(
      `claude plugin eval ${workspace.rel}/iteration-1/plugin --ablation with-without --runs 1 --concurrency 4 ` +
        `--model fast-m --max-cost-usd 5 --no-publish --trust-plugin --json ${workspace.rel}/iteration-1/fast.json ` +
        `--report ${workspace.rel}/iteration-1/fast.html`,
    );
    expect(
      readFileSync(workspace.path(`iteration-1/plugin/skills/${NAME}/SKILL.md`), 'utf8'),
    ).toContain(NAME);
  });

  it('EC-01: on a host without subagents it raises authoring.override and labels the skill', () => {
    host('gemini-cli');
    const workspace = workspaceAtS5();
    const result = runEvalPlan(workspace);
    expect(result.decision).toBeDefined();
    const packet = readContractDecisions(root)[0]!.packet;
    expect(packet.category).toBe('authoring.override');
    expect(packet.options.map((entry) => entry.label)).toEqual([
      'Add it unverified, kept in this project',
      'Do not add it',
    ]);
    expect(packet.recommendation).toBe('do-not-add');
  });

  it('AC-25: refuses before S4 is green', () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    workspace.writeJson('script-tests.json', { gate: 'failed' });
    expect(() => runEvalPlan(workspace)).toThrow(
      "S5 evals can't start: S4 lint and tests has not passed",
    );
  });
});

describe('S5 eval record on subagent dispatch', () => {
  function planned(workspace: SkillWorkspace): PlannedRun[] {
    runEvalPlan(workspace);
    return JSON.parse(
      readFileSync(workspace.path('iteration-1/runs.json'), 'utf8'),
    ) as PlannedRun[];
  }

  it('AC-6, AC-18: aggregates both arms on both tiers into benchmark.json with a delta', async () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    for (const entry of planned(workspace)) writeRun(workspace, entry, entry.arm === 'with_skill');
    const result = await runEvalRecord(workspace);
    expect(result.ok).toBe(true);
    const benchmark = JSON.parse(readFileSync(workspace.path('benchmark.json'), 'utf8'));
    expect(benchmark).toMatchObject({
      gate: 'passed',
      delta_points: 100,
      models: ['fast-m', 'strong-m'],
    });
    expect(benchmark.inputs_hash).toMatch(/^sha256:/);
    expect(readFileSync(workspace.path('iteration-1/analyst.md'), 'utf8')).toContain(
      '# Analyst notes',
    );
    for (const entry of JSON.parse(
      readFileSync(workspace.path('iteration-1/runs.json'), 'utf8'),
    ) as PlannedRun[]) {
      const base = entry.workdir.replace(`${workspace.rel}/`, '');
      expect(JSON.parse(readFileSync(workspace.path(`${base}/timing.json`), 'utf8')).model).toBe(
        entry.model,
      );
    }
  });

  it('improve mode passes an edit with no gain over the old skill', async () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    workspace.writeJson('mode.json', { entry: 'improve', source: '.claude/skills/x' });
    const runs = planned(workspace);
    expect(new Set(runs.map((entry) => entry.arm))).toEqual(new Set(['with_skill', 'old_skill']));
    for (const entry of runs) writeRun(workspace, entry, true);
    const result = await runEvalRecord(workspace);
    expect(result.ok).toBe(true);
    const benchmark = JSON.parse(readFileSync(workspace.path('benchmark.json'), 'utf8'));
    expect(benchmark).toMatchObject({ gate: 'passed', delta_points: 0 });
  });

  it('AC-44, AC-63: an interrupted iteration is partial, never aggregated, and status says how to resume', async () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    const runs = planned(workspace);
    for (const entry of runs.slice(1)) writeRun(workspace, entry, true);
    const first = runs[1]!.workdir.replace(`${workspace.rel}/`, '');
    workspace.write(first.replace(/run-1$/u, 'run-01') + '/outputs/x', 'x');
    await expect(runEvalRecord(workspace)).rejects.toThrow(
      /duplicate run directories: .* run 1 \(run-01, run-1\)/u,
    );
    await expect(runEvalRecord(workspace)).rejects.toThrow(
      /missing runs: happy|missing runs: edge/u,
    );
    expect(workspace.exists('iteration-1/benchmark.json')).toBe(false);
    const status = skillStatus(workspace);
    expect(status.lines.join('\n')).toContain('Iteration 1 is partial');
    expect(status.next).toBe(`paqad-ai skill eval record ${NAME}`);
  });

  it('FR-34: refuses a timing.json without tokens on subagent dispatch', async () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    for (const entry of planned(workspace)) writeRun(workspace, entry, true, null);
    await expect(runEvalRecord(workspace)).rejects.toThrow('timing.json is missing tokens');
  });

  it('AC-38, AC-19: the next iteration is new and reports its delta against the previous one', async () => {
    host('codex-cli');
    const workspace = workspaceAtS5();
    writeFileSync(
      join(root, '.paqad/.config'),
      'model_fast=fast-m\nmodel_reasoning=strong-m\nauthoring_runs_per_arm=1\nskill_eval_min_gain_points=100\n',
    );
    for (const entry of planned(workspace))
      writeRun(workspace, entry, entry.arm === 'with_skill' && entry.case === 'happy');
    const first = await runEvalRecord(workspace);
    expect(first.ok).toBe(false);
    const firstBenchmark = readFileSync(workspace.path('iteration-1/benchmark.json'), 'utf8');
    runEvalPlan(workspace);
    for (const entry of JSON.parse(
      readFileSync(workspace.path('iteration-2/runs.json'), 'utf8'),
    ) as PlannedRun[]) {
      writeRun(workspace, entry, entry.arm === 'with_skill');
    }
    const second = await runEvalRecord(workspace);
    expect(second.lines[0]).toContain('Against iteration 1: 50 points.');
    expect(readFileSync(workspace.path('iteration-1/benchmark.json'), 'utf8')).toBe(firstBenchmark);
  });
});

describe('S5 eval record on claude plugin eval', () => {
  function tierResult(passedWith: number, extra: Record<string, unknown> = {}) {
    return {
      claude_version: '2.1.302',
      unknown_field: true,
      cases: [
        {
          name: 'happy',
          runs: [
            { arm: 'with', run: 1, passed: passedWith, total: 2, duration_ms: 1000, cost_usd: 0.1 },
            { arm: 'without', run: 1, passed: 0, total: 2, duration_ms: 900, cost_usd: 0.05 },
          ],
        },
      ],
      ...extra,
    };
  }

  it('AC-16, AC-50: records the per-case delta with tokens unavailable and decides on gain alone', async () => {
    host('claude-code');
    const workspace = workspaceAtS5();
    runEvalPlan(workspace, { probe: () => '2.1.302' });
    workspace.writeJson('iteration-1/fast.json', tierResult(2));
    workspace.writeJson('iteration-1/reasoning.json', tierResult(2));
    const result = await runEvalRecord(workspace);
    expect(result.ok).toBe(true);
    const benchmark = JSON.parse(readFileSync(workspace.path('benchmark.json'), 'utf8'));
    expect(benchmark.tokens).toBe('unavailable on claude-plugin-eval');
    expect(benchmark.claude_version).toBe('2.1.302');
    expect(benchmark.cases).toEqual([
      { case: 'happy', pass_rate_with: 1, pass_rate_baseline: 0, delta_points: 100 },
    ]);
    expect(benchmark.checks_not_measured.map((check: { check: string }) => check.check)).toEqual([
      'token-multiple',
      'cache-hit',
    ]);
  });

  function realShape(withPasses: boolean[], extra: Record<string, unknown> = {}) {
    const run = (passed: boolean, error: string | null = null) => ({
      score: passed ? 1 : 0,
      passed,
      costUsd: 0.01,
      judgeCostUsd: 0.001,
      durationSeconds: 7,
      error,
      graders: [
        { name: 'criteria', passed, weight: 1, withOnly: false, scored: true },
        { name: 'skill-fired', passed: true, weight: 1, withOnly: true, scored: false },
      ],
    });
    return {
      schemaVersion: 1,
      claudeVersion: '2.1.302',
      partial: false,
      cases: [
        {
          name: 'happy',
          arms: {
            with: withPasses.map((passed) => run(passed)),
            without: [run(false), run(true, 'timeout')],
          },
        },
      ],
      ...extra,
    };
  }

  it('reads the claude plugin eval --json shape, scoring only the graders that count', async () => {
    host('claude-code');
    const workspace = workspaceAtS5();
    runEvalPlan(workspace, { probe: () => '2.1.302' });
    workspace.writeJson('iteration-1/fast.json', realShape([true, true]));
    workspace.writeJson('iteration-1/reasoning.json', realShape([true, false]));
    const result = await runEvalRecord(workspace);
    const benchmark = JSON.parse(readFileSync(workspace.path('benchmark.json'), 'utf8'));
    expect(benchmark.claude_version).toBe('2.1.302');
    expect(benchmark.cases).toEqual([
      { case: 'happy', pass_rate_with: 0.75, pass_rate_baseline: 0, delta_points: 75 },
    ]);
    expect(result.ok).toBe(true);
  });

  it('refuses a partial plugin sweep and records it as a defect', async () => {
    host('claude-code');
    const workspace = workspaceAtS5();
    runEvalPlan(workspace, { probe: () => '2.1.302' });
    workspace.writeJson('iteration-1/fast.json', realShape([true], { partial: true }));
    workspace.writeJson('iteration-1/reasoning.json', realShape([true]));
    await expect(runEvalRecord(workspace)).rejects.toThrow('fast.json is a partial sweep');
  });

  it('AC-63, INV-17: refuses a result missing a required field, naming it', async () => {
    host('claude-code');
    const workspace = workspaceAtS5();
    runEvalPlan(workspace, { probe: () => '2.1.302' });
    const broken = tierResult(2);
    delete (broken.cases[0]!.runs[0] as Record<string, unknown>).total;
    workspace.writeJson('iteration-1/fast.json', broken);
    workspace.writeJson('iteration-1/reasoning.json', tierResult(2));
    await expect(runEvalRecord(workspace)).rejects.toThrow(
      'fast.json cases[0].runs[0] is missing total.',
    );
    workspace.writeJson('iteration-1/fast.json', { cases: [] });
    await expect(runEvalRecord(workspace)).rejects.toThrow('is missing cases[] (or it is empty)');
  });
});

describe('S6 trigger plan and record', () => {
  function atS6(): SkillWorkspace {
    host('codex-cli');
    const workspace = workspaceAtS5();
    workspace.writeJson('benchmark.json', { gate: 'passed' });
    return workspace;
  }

  const queries = Array.from({ length: 20 }, (_, index) => ({
    query: `query ${index + 1}`,
    should_trigger: index < 10,
  }));

  function results(description: string, flip: string[] = []) {
    return {
      description,
      results: queries.flatMap((query, index) => {
        const id = `q-${String(index + 1).padStart(2, '0')}`;
        return [1, 2, 3].map((run) => ({
          id,
          run,
          fired: flip.includes(id) ? !query.should_trigger : query.should_trigger,
        }));
      }),
    };
  }

  it('FR-36: writes trigger-eval.json with seed 42 and the 60/40 split', () => {
    const workspace = atS6();
    const result = runTriggerPlan(workspace, JSON.stringify(queries));
    expect(result.lines[0]).toBe(
      '20 queries (10 should trigger, 10 near-misses), split 12 train / 8 validation with seed 42.',
    );
    const evalFile = JSON.parse(readFileSync(workspace.path('trigger-eval.json'), 'utf8'));
    expect(evalFile).toMatchObject({
      seed: 42,
      runs: 3,
      threshold: 0.9,
      min_runs: 2,
      batch: 'not-offered',
    });
  });

  it('AC-9: keeps the best validation score, marks it, and publishes a description of at most 1024 characters', () => {
    const workspace = atS6();
    runTriggerPlan(workspace, JSON.stringify(queries));
    const chosen = 'Parses supplier invoices into the ledger. Use when a supplier invoice arrives.';
    const record = runTriggerRecord(
      workspace,
      JSON.stringify({
        iterations: [
          results('first', [
            'q-01',
            'q-02',
            'q-03',
            'q-04',
            'q-05',
            'q-06',
            'q-07',
            'q-08',
            'q-09',
            'q-10',
          ]),
          results('x'.repeat(1025)),
          results(chosen),
        ],
        cost_usd: 1,
      }),
      { userHome: null },
    );
    expect(record.ok).toBe(true);
    const file = JSON.parse(readFileSync(workspace.path('trigger-results.json'), 'utf8'));
    expect(file.chosen_iteration).toBe(3);
    expect(file.description_chars).toBeLessThanOrEqual(1024);
    expect(file.iterations.map((entry: { chosen: boolean }) => entry.chosen)).toEqual([
      false,
      false,
      true,
    ]);
    expect(file.iterations[1].discarded).toBe(true);
    expect(readFileSync(workspace.path(`draft/${NAME}/SKILL.md`), 'utf8')).toContain(
      `description: ${chosen}\n`,
    );
    expect(file.inputs_hash).toMatch(/^sha256:/);
  });

  it('FR-35: refuses a sweep with missing ids', () => {
    const workspace = atS6();
    runTriggerPlan(workspace, JSON.stringify(queries));
    const partial = results('d');
    partial.results = partial.results.filter((entry) => entry.id !== 'q-05');
    expect(() => runTriggerRecord(workspace, JSON.stringify({ iterations: [partial] }))).toThrow(
      'Iteration 1 is missing results for q-05 run 1, q-05 run 2, q-05 run 3.',
    );
  });

  it('AC-13: the final description is checked for a collision before S7', () => {
    const workspace = atS6();
    mkdirSync(join(root, '.codex/skills/booking-invoices'), { recursive: true });
    writeFileSync(
      join(root, '.codex/skills/booking-invoices/SKILL.md'),
      '---\nname: booking-invoices\ndescription: Parses supplier invoices into the ledger. Use when a supplier invoice arrives.\n---\n',
    );
    runTriggerPlan(workspace, JSON.stringify(queries));
    const record = runTriggerRecord(
      workspace,
      JSON.stringify({
        iterations: [
          results('Parses supplier invoices into the ledger. Use when a supplier invoice arrives.'),
        ],
      }),
      { userHome: null },
    );
    expect(record.ok).toBe(false);
    expect(record.lines.at(-1)).toContain('the final description collides with booking-invoices');
  });
});
