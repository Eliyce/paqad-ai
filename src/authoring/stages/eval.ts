import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { readAuthoringConfig } from '../config.js';
import { raiseOverrideDecision } from '../decisions.js';
import {
  aggregateBenchmark,
  analystFacts,
  iterationLoopVerdict,
  judgeS5Gate,
  renderAnalyst,
  type EvalArm,
  type RunRecord,
} from '../eval/aggregate.js';
import {
  chooseEvalAdapter,
  evalTiers,
  type EvalAdapterChoice,
  type EvalTier,
} from '../eval/adapters.js';
import { recordGateFailure } from '../evidence.js';
import { hashFolderWithoutDescription, listFolderFiles } from '../hash.js';
import { SKILL_FILE } from '../paths.js';
import {
  AuthoringRefusal,
  readMode,
  requireEarlierGates,
  setWaiting,
  type SkillWorkspace,
} from '../workspace.js';
import { draftFolder } from './draft.js';
import { readWorkspaceIntake } from './intake.js';
import type { StageResult } from './result.js';

export const EVALS_DIR = 'evals';
export const PLAN_FILE = 'plan.json';
export const PARTIAL_FILE = 'partial.json';
export const PLUGIN_CONCURRENCY = 4;
export const MIN_CASES = 2;

export interface EvalCase {
  name: string;
  edge: boolean;
  source: 'case-folder' | 'evals.json';
}

export interface EvalPlan {
  iteration: number;
  adapter: EvalAdapterChoice;
  arms: EvalArm[];
  tiers: EvalTier[];
  runs_per_arm: number;
  cases: EvalCase[];
  total_runs: number;
  max_cost_usd_per_sweep: number;
  worst_case_spend_usd: number;
  commands: string[];
}

export interface PlannedRun {
  case: string;
  arm: EvalArm;
  tier: string;
  model: string;
  run: number;
  workdir: string;
}

function iterationDirs(workspace: SkillWorkspace): number[] {
  if (!workspace.exists('.')) return [];
  return readdirSync(workspace.dir)
    .map((name) => /^iteration-(\d+)$/u.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
}

export function latestIteration(workspace: SkillWorkspace): number | null {
  return iterationDirs(workspace).at(-1) ?? null;
}

function caseIsEdge(path: string): boolean {
  try {
    const meta = YAML.parse(readFileSync(path, 'utf8')) as { edge?: unknown } | null;
    return meta?.edge === true;
  } catch {
    return false;
  }
}

function readCases(workspace: SkillWorkspace): EvalCase[] {
  const root = workspace.path(EVALS_DIR);
  const cases: EvalCase[] = [];
  if (existsSync(root)) {
    for (const name of readdirSync(root).sort()) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(join(dir, 'prompt.md'))) {
        throw new AuthoringRefusal(
          `The case ${name} has no prompt.md. Add ${workspace.relPath(`${EVALS_DIR}/${name}/prompt.md`)}.`,
        );
      }
      const edge = caseIsEdge(join(dir, 'case.yaml'));
      cases.push({ name, edge, source: 'case-folder' });
    }
  }
  const legacy = workspace.readJson<{
    evals?: Array<{ id?: unknown; name?: unknown; edge?: unknown }>;
  }>(`${EVALS_DIR}/evals.json`);
  for (const entry of legacy?.evals ?? []) {
    const name = String(entry.name ?? entry.id ?? '');
    if (name !== '' && !cases.some((existing) => existing.name === name)) {
      cases.push({ name, edge: entry.edge === true, source: 'evals.json' });
    }
  }
  return cases;
}

function pluginWrapper(workspace: SkillWorkspace, iteration: number): string {
  const base = `iteration-${iteration}/plugin`;
  workspace.writeJson(`${base}/.claude-plugin/plugin.json`, {
    name: `${workspace.name}-eval`,
    version: '0.0.0',
    description: `Generated wrapper that evaluates the ${workspace.name} draft.`,
  });
  const draft = workspace.path(draftFolder(workspace));
  for (const file of listFolderFiles(draft)) {
    workspace.write(`${base}/skills/${workspace.name}/${file.rel}`, file.bytes.toString('utf8'));
  }
  for (const file of listFolderFiles(workspace.path(EVALS_DIR))) {
    workspace.write(`${base}/evals/${file.rel}`, file.bytes.toString('utf8'));
  }
  return workspace.relPath(base);
}

export function runEvalPlan(
  workspace: SkillWorkspace,
  options: { probe?: () => string | null; change?: string | null } = {},
): StageResult {
  requireEarlierGates(workspace, 'S5');
  const config = readAuthoringConfig(workspace.projectRoot);
  const cases = readCases(workspace);
  if (cases.length < MIN_CASES) {
    throw new AuthoringRefusal(
      `S5 needs at least ${MIN_CASES} cases in ${workspace.relPath(EVALS_DIR)}/<case>/prompt.md; found ${cases.length}.`,
    );
  }
  if (!cases.some((entry) => entry.edge)) {
    throw new AuthoringRefusal(
      'S5 needs at least one edge case: mark it with edge: true in its case.yaml.',
    );
  }
  const improve = readMode(workspace).entry === 'improve';
  let adapter = chooseEvalAdapter(workspace.projectRoot, options.probe);
  if (improve && adapter.adapter === 'claude-plugin-eval') {
    adapter = {
      ...adapter,
      adapter: 'subagent-dispatch',
      reason: 'improve mode compares against the snapshot',
    };
  }
  const iteration = (latestIteration(workspace) ?? 0) + 1;
  const arms: EvalArm[] = ['with_skill', improve ? 'old_skill' : 'without_skill'];
  const tiers = evalTiers(workspace.projectRoot);
  const runsPerArm = config.authoring_runs_per_arm;
  const cap = config.authoring_run_max_cost_usd;
  const totalRuns = cases.length * arms.length * runsPerArm * tiers.length;
  const commands: string[] = [];
  const lines: string[] = [];
  const iterDir = `iteration-${iteration}`;

  if (adapter.adapter === 'none') {
    const decision = raiseOverrideDecision(workspace.projectRoot, {
      skill: workspace.name,
      gate: 'S5',
      why: `${adapter.reason}. The skill can be self-tested but not benchmarked against a baseline.`,
      change: options.change,
    });
    workspace.writeJson('benchmark.json', {
      gate: 'failed',
      stage: 'S5',
      reason: 'self-tested, unbenchmarked: no subagents on this host',
      adapter: adapter.adapter,
      labels: ['self-tested', 'unbenchmarked'],
      decision,
    });
    setWaiting(workspace, {
      stage: 'S5',
      decision,
      resume: `paqad-ai skill override ${workspace.name} --gate S5 --decision ${decision}`,
    });
    return {
      ok: false,
      decision,
      artifacts: [workspace.relPath('benchmark.json')],
      lines: [
        `${adapter.reason}. The skill is self-tested and unbenchmarked; adding it needs decision ${decision}.`,
      ],
    };
  }

  if (adapter.adapter === 'claude-plugin-eval') {
    const wrapper = pluginWrapper(workspace, iteration);
    for (const tier of tiers) {
      const out = workspace.relPath(`${iterDir}/${tier.tier}`);
      commands.push(
        `claude plugin eval ${wrapper} --ablation with-without --runs ${runsPerArm} --concurrency ${PLUGIN_CONCURRENCY} ` +
          `--model ${tier.model} --max-cost-usd ${cap} --no-publish --trust-plugin --json ${out}.json --report ${out}.html`,
      );
    }
  } else {
    const runs: PlannedRun[] = [];
    for (const entry of cases) {
      for (const arm of arms) {
        for (const tier of tiers) {
          for (let run = 1; run <= runsPerArm; run += 1) {
            runs.push({
              case: entry.name,
              arm,
              tier: tier.tier,
              model: tier.model,
              run,
              workdir: workspace.relPath(`${iterDir}/${entry.name}/${arm}/${tier.tier}/run-${run}`),
            });
          }
        }
      }
    }
    workspace.writeJson(`${iterDir}/runs.json`, runs);
    commands.push(
      `Dispatch one fresh subagent per entry of ${workspace.relPath(`${iterDir}/runs.json`)}, ${PLUGIN_CONCURRENCY} at a time, ` +
        'and save outputs/, transcript.md, grading.json and timing.json (tokens, duration_ms, model) in each workdir.',
    );
  }
  const plan: EvalPlan = {
    iteration,
    adapter,
    arms,
    tiers,
    runs_per_arm: runsPerArm,
    cases,
    total_runs: totalRuns,
    max_cost_usd_per_sweep: cap,
    worst_case_spend_usd: cap * tiers.length,
    commands,
  };
  const artifact = workspace.writeJson(`${iterDir}/${PLAN_FILE}`, plan);
  lines.push(
    `Iteration ${iteration} on ${adapter.adapter} (${adapter.reason}): ${totalRuns} runs, worst-case spend $${plan.worst_case_spend_usd}.`,
    ...commands,
    `Then run paqad-ai skill eval record ${workspace.name}.`,
  );
  return { ok: true, artifacts: [artifact], lines };
}

function numberField(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

type PluginArm = 'with' | 'without';

function pluginArmRuns(
  where: string,
  arms: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const runs: Array<Record<string, unknown>> = [];
  for (const arm of ['with', 'without'] as PluginArm[]) {
    const entries = arms[arm];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      throw new AuthoringRefusal(`${where}.arms.${arm} is not a list of runs.`);
    }
    for (const [index, raw] of entries.entries()) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      if (!Array.isArray(entry.graders) || !numberField(entry.durationSeconds)) {
        throw new AuthoringRefusal(
          `${where}.arms.${arm}[${index}] is missing ${Array.isArray(entry.graders) ? 'durationSeconds' : 'graders[]'}.`,
        );
      }
      const scored = (entry.graders as Array<Record<string, unknown>>).filter(
        (grader) => grader.scored !== false && grader.withOnly !== true,
      );
      const errored = entry.error !== null && entry.error !== undefined;
      const cost = [entry.costUsd, entry.judgeCostUsd].filter(numberField);
      runs.push({
        arm,
        run: index + 1,
        passed: errored ? 0 : scored.filter((grader) => grader.passed === true).length,
        total: scored.length,
        duration_ms: Math.round(entry.durationSeconds * 1000),
        ...(cost.length > 0 ? { cost_usd: cost.reduce((sum, part) => sum + part, 0) } : {}),
      });
    }
  }
  return runs;
}

function readPluginResults(
  workspace: SkillWorkspace,
  plan: EvalPlan,
  baselineArm: EvalArm,
): { runs: RunRecord[]; claudeVersion: string | null } {
  const runs: RunRecord[] = [];
  let claudeVersion: string | null = plan.adapter.claude_version;
  for (const tier of plan.tiers) {
    const rel = `iteration-${plan.iteration}/${tier.tier}.json`;
    const parsed = workspace.readJson<Record<string, unknown>>(rel);
    if (parsed === null) {
      throw new AuthoringRefusal(
        `${workspace.relPath(rel)} is missing or not JSON. Run the ${tier.tier} command from paqad-ai skill eval plan ${workspace.name}.`,
      );
    }
    if (typeof parsed.claude_version === 'string') claudeVersion = parsed.claude_version;
    else if (typeof parsed.claudeVersion === 'string') claudeVersion = parsed.claudeVersion;
    if (parsed.partial === true) {
      throw new AuthoringRefusal(
        `${workspace.relPath(rel)} is a partial sweep (it hit the cost cap), so it was not aggregated. ` +
          recordGateFailure(workspace.projectRoot, {
            skill: workspace.name,
            gate: 'S5',
            evidencePath: workspace.relPath(rel),
          }),
      );
    }
    const cases = parsed.cases;
    if (!Array.isArray(cases) || cases.length === 0) {
      throw new AuthoringRefusal(`${workspace.relPath(rel)} is missing cases[] (or it is empty).`);
    }
    for (const [caseIndex, entry] of cases.entries()) {
      const record = entry as Record<string, unknown>;
      if (typeof record.name !== 'string') {
        throw new AuthoringRefusal(
          `${workspace.relPath(rel)} cases[${caseIndex}] is missing name.`,
        );
      }
      const armsRecord =
        typeof record.arms === 'object' && record.arms !== null
          ? (record.arms as Record<string, unknown>)
          : null;
      const caseRuns = Array.isArray(record.runs)
        ? (record.runs as unknown[])
        : armsRecord !== null
          ? pluginArmRuns(`${workspace.relPath(rel)} cases[${caseIndex}]`, armsRecord)
          : null;
      if (caseRuns === null) {
        throw new AuthoringRefusal(
          `${workspace.relPath(rel)} cases[${caseIndex}] is missing runs[] (or arms.with[] and arms.without[]).`,
        );
      }
      for (const [runIndex, raw] of caseRuns.entries()) {
        const run = raw as Record<string, unknown>;
        const missing = ['arm', 'run', 'passed', 'total', 'duration_ms'].filter((field) =>
          field === 'arm' ? run.arm !== 'with' && run.arm !== 'without' : !numberField(run[field]),
        );
        if (missing.length > 0) {
          throw new AuthoringRefusal(
            `${workspace.relPath(rel)} cases[${caseIndex}].runs[${runIndex}] is missing ${missing.join(', ')}.`,
          );
        }
        runs.push({
          case: record.name,
          arm: run.arm === 'with' ? 'with_skill' : baselineArm,
          tier: tier.tier,
          run: run.run as number,
          model: tier.model,
          assertions: [],
          passed: run.passed as number,
          total: run.total as number,
          tokens: null,
          duration_ms: run.duration_ms as number,
          cost_usd: numberField(run.cost_usd) ? run.cost_usd : null,
          cache_hit_share: null,
          max_tool_result_tokens: null,
          truncated: run.truncated === true,
        });
      }
    }
  }
  return { runs, claudeVersion };
}

function tokenTotal(value: unknown): number | null {
  if (numberField(value)) return value;
  if (typeof value === 'object' && value !== null) {
    const parts = Object.values(value as Record<string, unknown>).filter(numberField);
    return parts.length > 0 ? parts.reduce((sum, part) => sum + part, 0) : null;
  }
  return null;
}

function readDispatchResults(workspace: SkillWorkspace, plan: EvalPlan): RunRecord[] {
  const iterDir = `iteration-${plan.iteration}`;
  const planned = workspace.readJson<PlannedRun[]>(`${iterDir}/runs.json`) ?? [];
  const duplicates: string[] = [];
  const missing: string[] = [];
  const runs: RunRecord[] = [];
  const groups = [...new Set(planned.map((run) => `${run.case}/${run.arm}/${run.tier}`))];
  for (const group of groups) {
    const dir = workspace.path(`${iterDir}/${group}`);
    const seen = new Map<number, string[]>();
    if (existsSync(dir)) {
      for (const name of readdirSync(dir).sort()) {
        const number = /^run-0*(\d+)$/u.exec(name)?.[1];
        if (number === undefined) continue;
        seen.set(Number(number), [...(seen.get(Number(number)) ?? []), name]);
      }
    }
    for (const [number, names] of seen) {
      if (names.length > 1) duplicates.push(`${group} run ${number} (${names.join(', ')})`);
    }
  }
  for (const run of planned) {
    const base = `${iterDir}/${run.case}/${run.arm}/${run.tier}/run-${run.run}`;
    const timing = workspace.readJson<Record<string, unknown>>(`${base}/timing.json`);
    const grading = workspace.readJson<{ expectations?: unknown; truncated?: unknown }>(
      `${base}/grading.json`,
    );
    if (timing === null || grading === null || !workspace.exists(`${base}/outputs`)) {
      missing.push(`${run.case} / ${run.arm} / ${run.tier} / run ${run.run}`);
      continue;
    }
    const tokens = tokenTotal(timing.tokens);
    const fields = [
      typeof timing.model === 'string' ? null : 'model',
      numberField(timing.duration_ms) ? null : 'duration_ms',
      tokens === null ? 'tokens' : null,
    ].filter((field): field is string => field !== null);
    if (fields.length > 0) {
      throw new AuthoringRefusal(
        `${workspace.relPath(`${base}/timing.json`)} is missing ${fields.join(', ')}.`,
      );
    }
    const expectations = Array.isArray(grading.expectations) ? grading.expectations : null;
    if (expectations === null) {
      throw new AuthoringRefusal(
        `${workspace.relPath(`${base}/grading.json`)} is missing expectations[].`,
      );
    }
    const assertions = expectations.map((raw) => {
      const item = raw as { text?: unknown; passed?: unknown };
      return {
        text: String(item.text ?? ''),
        passed: typeof item.passed === 'boolean' ? item.passed : null,
      };
    });
    const failedRun =
      timing.capped === true || (numberField(timing.exit_code) && timing.exit_code !== 0);
    const verifiable = assertions.filter((assertion) => assertion.passed !== null);
    runs.push({
      case: run.case,
      arm: run.arm,
      tier: run.tier,
      run: run.run,
      model: timing.model as string,
      assertions,
      passed: failedRun ? 0 : verifiable.filter((assertion) => assertion.passed).length,
      total: verifiable.length,
      tokens,
      duration_ms: timing.duration_ms as number,
      cost_usd: numberField(timing.cost_usd) ? timing.cost_usd : null,
      cache_hit_share: numberField(timing.cache_hit_share) ? timing.cache_hit_share : null,
      max_tool_result_tokens: numberField(timing.max_tool_result_tokens)
        ? timing.max_tool_result_tokens
        : null,
      truncated: grading.truncated === true,
    });
    if (failedRun) {
      recordGateFailure(workspace.projectRoot, {
        skill: workspace.name,
        gate: 'S5',
        evidencePath: workspace.relPath(base),
      });
    }
  }
  if (duplicates.length > 0 || missing.length > 0) {
    workspace.writeJson(`${iterDir}/${PARTIAL_FILE}`, { duplicates, missing });
    const parts: string[] = [];
    if (duplicates.length > 0) parts.push(`duplicate run directories: ${duplicates.join('; ')}`);
    if (missing.length > 0) parts.push(`missing runs: ${missing.join('; ')}`);
    throw new AuthoringRefusal(
      `Iteration ${plan.iteration} is partial and was not aggregated (${parts.join('. ')}). Finish the runs, then rerun paqad-ai skill eval record ${workspace.name}.`,
    );
  }
  return runs;
}

interface BenchmarkHistoryEntry {
  iteration: number;
  passed: boolean;
  pass_rate_with: number;
  delta_points: number;
  delta_vs_previous_points: number | null;
}

export async function runEvalRecord(
  workspace: SkillWorkspace,
  options: { feedbackEmpty?: boolean } = {},
): Promise<StageResult> {
  requireEarlierGates(workspace, 'S5');
  const iteration = latestIteration(workspace);
  const plan =
    iteration === null ? null : workspace.readJson<EvalPlan>(`iteration-${iteration}/${PLAN_FILE}`);
  if (plan === null) {
    throw new AuthoringRefusal(
      `There is no planned iteration. Run paqad-ai skill eval plan ${workspace.name} first.`,
    );
  }
  const iterDir = `iteration-${plan.iteration}`;
  if (workspace.exists(`${iterDir}/benchmark.json`)) {
    throw new AuthoringRefusal(
      `Iteration ${plan.iteration} is already recorded. Revise the skill and run paqad-ai skill eval plan ${workspace.name} for the next one.`,
    );
  }
  const baselineArm = plan.arms[1]!;
  const config = readAuthoringConfig(workspace.projectRoot);
  let claudeVersion: string | null = plan.adapter.claude_version;
  let runs: RunRecord[];
  if (plan.adapter.adapter === 'claude-plugin-eval') {
    const read = readPluginResults(workspace, plan, baselineArm);
    runs = read.runs;
    claudeVersion = read.claudeVersion;
  } else {
    runs = readDispatchResults(workspace, plan);
  }
  const tiersWithRuns = new Set(runs.map((run) => run.tier));
  const lackingTier = plan.tiers
    .filter((tier) => !tiersWithRuns.has(tier.tier))
    .map((tier) => tier.tier);
  if (lackingTier.length > 0) {
    throw new AuthoringRefusal(
      `Iteration ${plan.iteration} has no runs on the ${lackingTier.join(', ')} tier.`,
    );
  }

  const summary = aggregateBenchmark(runs, baselineArm);
  const intake = readWorkspaceIntake(workspace);
  let subjective: { preferred: Array<'new' | 'old' | 'tie'> } | null = null;
  if (intake?.verifiability === 'subjective') {
    const comparison = workspace.readJson<{ cases?: Array<{ preferred?: unknown }> }>(
      `${iterDir}/comparison.json`,
    );
    if (!Array.isArray(comparison?.cases)) {
      throw new AuthoringRefusal(
        `${workspace.relPath(`${iterDir}/comparison.json`)} is missing. A subjective skill is judged by the blind comparator: record {cases: [{case, preferred: new | old | tie}]}.`,
      );
    }
    subjective = {
      preferred: comparison.cases.map((entry) =>
        entry.preferred === 'new' || entry.preferred === 'old' ? entry.preferred : 'tie',
      ),
    };
  }
  const gate = judgeS5Gate({
    summary,
    adapter: plan.adapter.adapter,
    minGainPoints: config.skill_eval_min_gain_points,
    maxTokenMultiple: config.skill_eval_max_token_multiple,
    subjective,
  });
  const previous =
    workspace.readJson<{ history?: BenchmarkHistoryEntry[] }>('benchmark.json')?.history ?? [];
  const last = previous.at(-1);
  const entry: BenchmarkHistoryEntry = {
    iteration: plan.iteration,
    passed: gate.passed,
    pass_rate_with: summary.pass_rate_with,
    delta_points: summary.delta_points,
    delta_vs_previous_points:
      last === undefined
        ? null
        : Math.round((summary.pass_rate_with - last.pass_rate_with) * 10000) / 100,
  };
  const history = [...previous, entry];
  const verdict = await iterationLoopVerdict(
    history,
    config.authoring_max_iterations,
    options.feedbackEmpty,
  );
  const tokensNote = gate.checks_not_measured[0]?.reason ?? null;
  const facts = analystFacts({
    runs,
    baselineArm,
    toolResultMaxTokens: config.authoring_tool_result_max_tokens,
    cacheHitMin: config.authoring_cache_hit_min,
  });
  const iterationBenchmark = {
    iteration: plan.iteration,
    adapter: plan.adapter.adapter,
    claude_version: claudeVersion,
    subjective: subjective !== null,
    ...summary,
    checks_not_measured: gate.checks_not_measured,
    gate: gate.passed ? 'passed' : 'failed',
  };
  workspace.writeJson(`${iterDir}/benchmark.json`, iterationBenchmark);
  workspace.write(`${iterDir}/analyst.md`, renderAnalyst(facts, tokensNote));
  workspace.write(
    `${iterDir}/report.html`,
    `<!doctype html><title>${workspace.name} iteration ${plan.iteration}</title><pre>${JSON.stringify(iterationBenchmark, null, 2).replace(/</g, '&lt;')}</pre>\n`,
  );
  const folder = workspace.path(draftFolder(workspace));
  const artifact = workspace.writeJson('benchmark.json', {
    gate: gate.passed ? 'passed' : 'failed',
    stage: 'S5',
    ...(gate.passed ? {} : { reason: gate.reasons.join('; ') }),
    iteration: plan.iteration,
    adapter: plan.adapter.adapter,
    claude_version: claudeVersion,
    inputs_hash: existsSync(join(folder, SKILL_FILE)) ? hashFolderWithoutDescription(folder) : null,
    pass_rate_with: summary.pass_rate_with,
    pass_rate_baseline: summary.pass_rate_baseline,
    delta_points: summary.delta_points,
    token_multiple: summary.token_multiple,
    tokens: summary.tokens_available ? 'measured' : `unavailable on ${plan.adapter.adapter}`,
    checks_not_measured: gate.checks_not_measured,
    models: summary.models,
    cases: summary.cases,
    loop: verdict,
    history,
  });
  const lines = [
    `Iteration ${plan.iteration}: with the skill ${Math.round(summary.pass_rate_with * 100)}%, ` +
      `${baselineArm.replace('_', ' ')} ${Math.round(summary.pass_rate_baseline * 100)}%, ${summary.delta_points} points.` +
      (entry.delta_vs_previous_points === null
        ? ''
        : ` Against iteration ${last!.iteration}: ${entry.delta_vs_previous_points} points.`),
    ...gate.checks_not_measured.map((check) => `${check.check}: not measured (${check.reason}).`),
  ];
  if (gate.passed) {
    lines.push(`S5 passed. Next: paqad-ai skill trigger plan ${workspace.name} <queries.json>`);
  } else if (verdict.status === 'stopped') {
    lines.push(
      `S5 failed: ${gate.reasons.join('; ')}. The loop stopped because ${verdict.reason}.`,
      recordGateFailure(workspace.projectRoot, {
        skill: workspace.name,
        gate: 'S5',
        evidencePath: workspace.relPath(iterDir),
      }),
    );
  } else {
    lines.push(`S5 failed: ${gate.reasons.join('; ')}. ${verdict.reason}.`);
  }
  return { ok: gate.passed, artifacts: [artifact, workspace.relPath(iterDir)], lines };
}
