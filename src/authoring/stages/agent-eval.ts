import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, posix } from 'node:path';

import YAML from 'yaml';

import { readAuthoringConfig } from '../config.js';
import {
  chooseEvalAdapter,
  evalTiers,
  type EvalAdapter,
  type EvalAdapterChoice,
  type EvalTier,
} from '../eval/adapters.js';
import {
  aggregateBenchmark,
  analystFacts,
  iterationLoopVerdict,
  median,
  type EvalArm,
  type RunRecord,
} from '../eval/aggregate.js';
import {
  cheapestPassingTier,
  judgeAgentS5Gate,
  latencyMeasure,
  memoryDecision,
  PASS_K,
  reliabilityTable,
  trialPassed,
  type AgentArmMetrics,
  type Reliability,
} from '../eval/passk.js';
import { planSpend, recordSpend } from '../eval/spend.js';
import { recordGateFailure } from '../evidence.js';
import { lintAgentInProject, POWER_RULES } from '../lint/agent-lint.js';
import { meetsThreshold } from '../thresholds.js';
import {
  AuthoringRefusal,
  readMode,
  requireEarlierGates,
  type AuthoringWorkspace,
} from '../workspace.js';
import { agentDraftFile, readAgentDraftSource } from './agent-draft.js';
import { readAgentIntake, type AgentIntake } from './agent-intake.js';
import { draftAgentHashWithoutDescription } from './agent-test.js';
import type { StageResult } from './result.js';

export const AGENT_EVALS_DIR = 'evals';
export const AGENT_PLAN_FILE = 'plan.json';
export const AGENT_MIN_CASES = 2;
export const REVISION_LEVERS = ['brief', 'tools', 'stopping', 'report', 'prose'] as const;
export type RevisionLever = (typeof REVISION_LEVERS)[number];
export const STAGE_AGENT_ROOTS = [
  'runtime/templates/stage-agents/',
  'runtime/claude-plugin/agents/',
];
export const INDEPENDENT_CALLS_LINE =
  "When several tool calls don't depend on each other, make them in the same turn.";
export const TOOL_USE_BLOCKS_FLOOR = 1;

export interface AgentCase {
  name: string;
  adversarial: boolean;
  clean_input: boolean;
  planted_failure: boolean;
  repo_state: { git_ref?: string; fixture_tarball?: string };
  inputs: string[];
  expected: string;
}

export interface AgentTrial {
  case: string;
  arm: EvalArm;
  tier: EvalTier['tier'];
  model: string;
  trial: number;
  custom_id: string;
  workdir: string;
}

export interface AgentEvalPlan {
  iteration: number;
  adapter: EvalAdapterChoice;
  arms: EvalArm[];
  baseline_arm: EvalArm;
  tiers: EvalTier[];
  trials_per_arm: number;
  cases: AgentCase[];
  lever: RevisionLever | null;
  stage_agent: boolean;
  total_trials: number;
  max_cost_usd_per_trial: number;
  worst_case_spend_usd: number;
  batch: 'available' | 'unavailable';
  fresh_context: true;
  clean_repo_state: true;
  commands: string[];
}

export interface TarEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  link?: string;
}

export function unsafeTarEntries(entries: readonly TarEntry[]): string[] {
  const escapes = (path: string) => {
    const clean = posix.normalize(path.replaceAll('\\', '/'));
    return isAbsolute(path) || path.startsWith('/') || clean === '..' || clean.startsWith('../');
  };
  const problems: string[] = [];
  for (const entry of entries) {
    if (escapes(entry.path) || entry.path.split(/[\\/]/u).includes('..')) {
      problems.push(`${entry.path} is an absolute path or holds a .. segment`);
      continue;
    }
    if (entry.type === 'symlink') {
      const target = entry.link ?? '';
      const resolved = posix.normalize(posix.join(posix.dirname(entry.path), target));
      if (target.startsWith('/') || resolved === '..' || resolved.startsWith('../')) {
        problems.push(`${entry.path} is a symlink pointing outside the trial directory`);
      }
    }
  }
  return problems;
}

function listTarball(path: string): TarEntry[] {
  const out = execFileSync('tar', ['-tvf', path], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line): TarEntry => {
      const kind = line[0];
      const rest = line.split(/\s+/u).slice(5).join(' ');
      if (kind === 'l') {
        const [name, link] = rest.split(' -> ');
        return { path: name!, type: 'symlink', link };
      }
      return { path: rest, type: kind === 'd' ? 'directory' : kind === '-' ? 'file' : 'other' };
    });
}

function iterationNumbers(workspace: AuthoringWorkspace): number[] {
  if (!existsSync(workspace.dir)) return [];
  return readdirSync(workspace.dir)
    .map((name) => /^iteration-(\d+)$/u.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
}

export function latestAgentIteration(workspace: AuthoringWorkspace): number | null {
  return iterationNumbers(workspace).at(-1) ?? null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export function readAgentCases(workspace: AuthoringWorkspace): AgentCase[] {
  const root = workspace.path(AGENT_EVALS_DIR);
  if (!existsSync(root)) return [];
  const cases: AgentCase[] = [];
  for (const name of readdirSync(root).sort()) {
    if (!statSync(join(root, name)).isDirectory()) continue;
    const rel = `${AGENT_EVALS_DIR}/${name}/case.yaml`;
    const text = workspace.read(rel);
    if (text === null) {
      throw new AuthoringRefusal(
        `The case ${name} has no case.yaml. Add ${workspace.relPath(rel)}.`,
      );
    }
    if (!workspace.exists(`${AGENT_EVALS_DIR}/${name}/prompt.md`)) {
      throw new AuthoringRefusal(
        `The case ${name} has no prompt.md (the delegation message). Add ${workspace.relPath(`${AGENT_EVALS_DIR}/${name}/prompt.md`)}.`,
      );
    }
    const meta = (YAML.parse(text) ?? {}) as Record<string, unknown>;
    const state = (meta.repo_state ?? {}) as Record<string, unknown>;
    const repoState = {
      ...(typeof state.git_ref === 'string' ? { git_ref: state.git_ref } : {}),
      ...(typeof state.fixture_tarball === 'string'
        ? { fixture_tarball: state.fixture_tarball }
        : {}),
    };
    const expected = typeof meta.expected === 'string' ? meta.expected : '';
    const missing = [
      ...(Object.keys(repoState).length === 0 ? ['repo_state (git_ref or fixture_tarball)'] : []),
      ...(stringList(meta.inputs).length === 0 ? ['inputs'] : []),
      ...(expected.trim() === '' ? ['expected'] : []),
    ];
    if (missing.length > 0) {
      throw new AuthoringRefusal(`${workspace.relPath(rel)} is missing ${missing.join(', ')}.`);
    }
    cases.push({
      name,
      adversarial: meta.adversarial === true,
      clean_input: meta.clean_input === true,
      planted_failure: meta.planted_failure === true,
      repo_state: repoState,
      inputs: stringList(meta.inputs),
      expected,
    });
  }
  return cases;
}

export function isStageAgent(workspace: AuthoringWorkspace): boolean {
  const source = readAgentDraftSource(workspace)?.file ?? '';
  return STAGE_AGENT_ROOTS.some((root) => source.startsWith(root));
}

export function baselineArmFor(workspace: AuthoringWorkspace): EvalArm {
  if (readMode(workspace).entry === 'improve') return 'old_agent';
  if (workspace.name === 'Explore') return 'builtin_explore';
  return 'main_thread';
}

function requireIntake(workspace: AuthoringWorkspace): AgentIntake {
  const intake = readAgentIntake(workspace);
  if (intake === null) {
    throw new AuthoringRefusal(
      `${workspace.relPath('intake.yaml')} is missing. Run paqad-ai agent intake ${workspace.name} <intake.yaml> first.`,
    );
  }
  return intake;
}

function checkCases(
  workspace: AuthoringWorkspace,
  cases: readonly AgentCase[],
  intake: AgentIntake,
  stageAgent: boolean,
): void {
  if (cases.length < AGENT_MIN_CASES) {
    throw new AuthoringRefusal(
      `S5 needs at least ${AGENT_MIN_CASES} task cases in ${workspace.relPath(AGENT_EVALS_DIR)}/<case>/case.yaml; found ${cases.length}.`,
    );
  }
  if (!cases.some((entry) => entry.adversarial)) {
    throw new AuthoringRefusal(
      'S5 needs at least one adversarial case: mark it adversarial: true.',
    );
  }
  if (intake.class === 'reviewer' && !cases.some((entry) => entry.clean_input)) {
    throw new AuthoringRefusal(
      'A reviewer needs at least one clean input it must stay silent on: mark it clean_input: true.',
    );
  }
  if (stageAgent && !cases.some((entry) => entry.planted_failure)) {
    throw new AuthoringRefusal(
      'A stage agent needs a planted-failure case the stage must surface: mark it planted_failure: true.',
    );
  }
  for (const entry of cases) {
    const tarball = entry.repo_state.fixture_tarball;
    if (tarball === undefined) continue;
    const abs = workspace.path(`${AGENT_EVALS_DIR}/${entry.name}/${normalize(tarball)}`);
    if (!existsSync(abs)) {
      throw new AuthoringRefusal(
        `The fixture tarball ${tarball} of the case ${entry.name} is missing.`,
      );
    }
    const problems = unsafeTarEntries(listTarball(abs));
    if (problems.length > 0) {
      throw new AuthoringRefusal(
        `The fixture tarball of the case ${entry.name} is refused before extraction: ${problems.join('; ')}.`,
      );
    }
  }
}

function refuseUnapprovedPowers(workspace: AuthoringWorkspace): void {
  const lint = lintAgentInProject(workspace.projectRoot, workspace.path(agentDraftFile(workspace)));
  const blocked = lint.findings.filter(
    (finding) => finding.severity === 'block' && POWER_RULES.includes(finding.rule),
  );
  if (blocked.length > 0) {
    throw new AuthoringRefusal(
      `S5 can't run trials: ${workspace.name} asks for ${lint.powers.join(', ')} with no resolved authoring.agent_permission packet. Run paqad-ai agent test ${workspace.name} first.`,
    );
  }
}

function pluginWrapper(workspace: AuthoringWorkspace, iteration: number): string {
  const base = `iteration-${iteration}/plugin`;
  workspace.writeJson(`${base}/.claude-plugin/plugin.json`, {
    name: `${workspace.name}-eval`,
    version: '0.0.0',
    description: `Generated wrapper that evaluates the ${workspace.name} agent draft.`,
  });
  workspace.write(
    `${base}/agents/${workspace.name}.md`,
    workspace.read(agentDraftFile(workspace)) ?? '',
  );
  return workspace.relPath(base);
}

export function trialCustomId(trial: Omit<AgentTrial, 'custom_id' | 'workdir' | 'model'>): string {
  return `${trial.case}:${trial.arm}:${trial.tier}:${trial.trial}`;
}

export interface AgentEvalPlanOptions {
  probe?: () => string | null;
  lever?: string;
  batchAvailable?: boolean;
  change?: string | null;
}

function asLever(value: string | undefined, iteration: number): RevisionLever | null {
  if (iteration === 1 && value === undefined) return null;
  if (value === undefined) {
    throw new AuthoringRefusal(
      `Iteration ${iteration} revises the agent: name the lever with --lever (${REVISION_LEVERS.join(', ')}), in that order of preference.`,
      2,
    );
  }
  if (!(REVISION_LEVERS as readonly string[]).includes(value)) {
    throw new AuthoringRefusal(`--lever must be one of ${REVISION_LEVERS.join(', ')}.`, 2);
  }
  return value as RevisionLever;
}

export function runAgentEvalPlan(
  workspace: AuthoringWorkspace,
  options: AgentEvalPlanOptions = {},
): StageResult {
  requireEarlierGates(workspace, 'S5');
  const config = readAuthoringConfig(workspace.projectRoot);
  const intake = requireIntake(workspace);
  const stageAgent = isStageAgent(workspace);
  const cases = readAgentCases(workspace);
  checkCases(workspace, cases, intake, stageAgent);
  refuseUnapprovedPowers(workspace);
  const adapter = chooseEvalAdapter(workspace.projectRoot, options.probe);
  if (adapter.adapter === 'none') {
    const artifact = workspace.writeJson('benchmark.json', {
      gate: 'failed',
      stage: 'S5',
      reason: `not deployable: ${adapter.reason}`,
      adapter: adapter.adapter,
      deployable: { [adapter.host]: false },
      proposal: `propose a skill for ${adapter.host}, which runs no subagents`,
    });
    return {
      ok: false,
      artifacts: [artifact],
      lines: [
        `${adapter.reason}, so S5 cannot run there: ${workspace.name} is not deployable on ${adapter.host}. Propose a skill for that host instead.`,
      ],
    };
  }
  const previous = latestAgentIteration(workspace);
  if (previous !== null && !workspace.exists(`iteration-${previous}/benchmark.json`)) {
    throw new AuthoringRefusal(
      `Iteration ${previous} is planned but not recorded. Run paqad-ai agent eval record ${workspace.name} first.`,
    );
  }
  const iteration = (previous ?? 0) + 1;
  if (iteration > config.authoring_max_iterations) {
    throw new AuthoringRefusal(
      `The S5 loop stops at ${config.authoring_max_iterations} iterations; iteration ${iteration} is not planned.`,
    );
  }
  const lever = asLever(options.lever, iteration);
  const baselineArm = baselineArmFor(workspace);
  const arms: EvalArm[] = [
    'with_agent',
    baselineArm,
    ...(intake.memory === 'candidate' ? (['with_agent_memory'] as const) : []),
  ];
  const tiers = evalTiers(workspace.projectRoot);
  const iterDir = `iteration-${iteration}`;
  const trials: AgentTrial[] = [];
  for (const entry of cases) {
    for (const arm of arms) {
      for (const tier of tiers) {
        for (let trial = 1; trial <= PASS_K; trial += 1) {
          const key = { case: entry.name, arm, tier: tier.tier, trial };
          trials.push({
            ...key,
            model: tier.model,
            custom_id: trialCustomId(key),
            workdir: workspace.relPath(
              `${iterDir}/${entry.name}/${arm}/${tier.tier}/trial-${trial}`,
            ),
          });
        }
      }
    }
  }
  workspace.writeJson(`${iterDir}/trials.json`, trials);
  const cap = config.authoring_run_max_cost_usd;
  const worst = Math.round(trials.length * cap * 1e6) / 1e6;
  const total = planSpend(workspace, `S5-iteration-${iteration}`, worst);
  const batch =
    options.batchAvailable === true && config.authoring_batch_mode !== 'off'
      ? 'available'
      : 'unavailable';
  const commands: string[] = [];
  if (adapter.adapter === 'claude-plugin-eval') {
    const wrapper = pluginWrapper(workspace, iteration);
    for (const tier of tiers) {
      commands.push(
        `claude plugin eval ${wrapper} --ablation with-without --runs ${PASS_K} --model ${tier.model} ` +
          `--max-cost-usd ${cap} --no-publish --trust-plugin --json ${workspace.relPath(`${iterDir}/${tier.tier}`)}.json`,
      );
    }
  }
  commands.push(
    `Run each trial of ${workspace.relPath(`${iterDir}/trials.json`)} in a fresh context on a clean copy of its case's repo state ` +
      `(never the working checkout), under the session's permission mode and a $${cap} spend cap, and save outputs/, ` +
      'transcript.md, grading.json and timing.json in its workdir.',
  );
  if (baselineArm === 'old_agent') {
    commands.push(
      `The old_agent arm runs the installed agent snapshotted in ${workspace.relPath(`agent-snapshot/${workspace.name}.md`)}.`,
    );
  }
  const plan: AgentEvalPlan = {
    iteration,
    adapter,
    arms,
    baseline_arm: baselineArm,
    tiers,
    trials_per_arm: PASS_K,
    cases,
    lever,
    stage_agent: stageAgent,
    total_trials: trials.length,
    max_cost_usd_per_trial: cap,
    worst_case_spend_usd: worst,
    batch,
    fresh_context: true,
    clean_repo_state: true,
    commands,
  };
  const artifact = workspace.writeJson(`${iterDir}/${AGENT_PLAN_FILE}`, plan);
  return {
    ok: true,
    artifacts: [artifact],
    lines: [
      `Iteration ${iteration} on ${adapter.adapter} (${adapter.reason}): ${trials.length} trials, worst-case spend $${worst} (this agent's planned total so far: $${total}).`,
      ...commands,
      `Then run paqad-ai agent eval record ${workspace.name}.`,
    ],
  };
}

type Measured = number | null;

export interface TrialTiming {
  tokens: Measured;
  duration_ms: number;
  queue_ms: number;
  tool_calls: Measured;
  turns: Measured;
  max_turns_hit: boolean;
  spend_cap_hit: boolean;
  cost_usd: Measured;
  cache_hit_share: Measured;
  tool_use_blocks_per_message: Measured;
  max_tool_result_tokens: Measured;
  returned_to_main_tokens: Measured;
  form: string;
  source: EvalAdapter | null;
  unenforced_rules: string[];
  batched: boolean;
  fell_back: boolean;
}

const TIMING_NUMBERS = ['tokens', 'tool_calls', 'turns'] as const;

function measured(value: unknown): Measured | undefined {
  if (value === 'unavailable' || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function steadyCacheHitShare(requests: unknown): number | null {
  if (!Array.isArray(requests) || requests.length < 2) return null;
  let read = 0;
  let total = 0;
  for (const request of requests.slice(1) as Array<Record<string, unknown>>) {
    const cached = typeof request?.cache_read === 'number' ? request.cache_read : 0;
    const fresh = typeof request?.input === 'number' ? request.input : 0;
    read += cached;
    total += cached + fresh;
  }
  return total === 0 ? null : Math.round((read / total) * 10000) / 10000;
}

function readTiming(workspace: AuthoringWorkspace, trial: AgentTrial, rel: string): TrialTiming {
  const raw = workspace.readJson<Record<string, unknown>>(`${rel}/timing.json`);
  if (raw === null) {
    throw new AuthoringRefusal(
      `The trial ${trial.custom_id} has no timing.json in ${trial.workdir}.`,
    );
  }
  const duration = measured(raw.duration_ms);
  const missing = [
    ...TIMING_NUMBERS.filter((field) => measured(raw[field]) === undefined),
    ...(duration === undefined || duration === null ? ['duration_ms'] : []),
    ...(typeof raw.max_turns_hit === 'boolean' ? [] : ['max_turns_hit']),
  ];
  if (missing.length > 0) {
    throw new AuthoringRefusal(
      `The trial ${trial.custom_id} timing.json is missing ${missing.join(', ')} (write "unavailable" when the host gives no number).`,
    );
  }
  const number = (field: string) => measured(raw[field]) ?? null;
  return {
    tokens: number('tokens'),
    duration_ms: duration as number,
    queue_ms: number('queue_ms') ?? 0,
    tool_calls: number('tool_calls'),
    turns: number('turns'),
    max_turns_hit: raw.max_turns_hit === true,
    spend_cap_hit: raw.spend_cap_hit === true,
    cost_usd: number('cost_usd'),
    cache_hit_share: steadyCacheHitShare(raw.requests) ?? number('cache_hit_share'),
    tool_use_blocks_per_message: number('tool_use_blocks_per_message'),
    max_tool_result_tokens: number('max_tool_result_tokens'),
    returned_to_main_tokens: number('returned_to_main_tokens'),
    form: typeof raw.form === 'string' ? raw.form : 'project-agent',
    source: trialSource(raw.source),
    unenforced_rules: stringList(raw.unenforced_rules),
    batched: raw.batched === true,
    fell_back: raw.fell_back === true,
  };
}

interface Grading {
  assertions: Array<{ text: string; passed: boolean | null; evidence?: string }>;
  test_command_exit?: number;
  reported_defects?: number;
  report_tokens?: number;
  claimed_done?: boolean;
  missing_artifacts?: string[];
}

function readGrading(workspace: AuthoringWorkspace, trial: AgentTrial, rel: string): Grading {
  const raw = workspace.readJson<Partial<Grading>>(`${rel}/grading.json`);
  if (raw === null || !Array.isArray(raw.assertions) || raw.assertions.length === 0) {
    throw new AuthoringRefusal(
      `The trial ${trial.custom_id} has no grading.json with assertions in ${trial.workdir}.`,
    );
  }
  const unevidenced = raw.assertions.filter(
    (entry) => typeof entry?.evidence !== 'string' || entry.evidence.trim() === '',
  );
  if (unevidenced.length > 0) {
    throw new AuthoringRefusal(
      `The trial ${trial.custom_id} grading.json cites no evidence for: ${unevidenced.map((entry) => entry.text).join(', ')}.`,
    );
  }
  return raw as Grading;
}

export interface OutcomeRule {
  text: string;
  evidence: string;
}

export function outcomeFailures(input: {
  grading: Grading;
  timing: Pick<TrialTiming, 'max_turns_hit' | 'spend_cap_hit'>;
  agentCase: AgentCase;
  intake: Pick<AgentIntake, 'class' | 'report'>;
  stageAgent: boolean;
}): OutcomeRule[] {
  const failures: OutcomeRule[] = [];
  const { grading } = input;
  if (
    input.intake.class === 'builder' &&
    typeof grading.test_command_exit === 'number' &&
    grading.test_command_exit !== 0
  ) {
    failures.push({
      text: "the project's test command stays green",
      evidence: `the test command exited ${grading.test_command_exit}, whatever the report says`,
    });
  }
  if (
    input.intake.class === 'reviewer' &&
    input.agentCase.clean_input &&
    (grading.reported_defects ?? 0) > 0
  ) {
    failures.push({
      text: 'stays silent on the clean input',
      evidence: `reported ${grading.reported_defects} defect(s) on a clean input`,
    });
  }
  const max = input.intake.report.max_tokens;
  if (typeof grading.report_tokens === 'number' && grading.report_tokens > max) {
    failures.push({
      text: `the report stays within ${max} tokens`,
      evidence: `the report is ${grading.report_tokens} tokens, ${grading.report_tokens - max} over its maximum`,
    });
  }
  if (
    input.stageAgent &&
    grading.claimed_done === true &&
    (grading.missing_artifacts ?? []).length > 0
  ) {
    failures.push({
      text: 'every required stage artifact exists when it reports done',
      evidence: `it reported done with ${grading.missing_artifacts!.join(', ')} missing`,
    });
  }
  if (input.timing.max_turns_hit) {
    failures.push({
      text: 'finishes within maxTurns',
      evidence: 'the trial hit maxTurns, so it is cut off',
    });
  }
  if (input.timing.spend_cap_hit) {
    failures.push({
      text: 'finishes within the spend cap',
      evidence: 'the trial hit the spend cap, so it is partial',
    });
  }
  return failures;
}

interface TrialRecord {
  trial: AgentTrial;
  run: RunRecord;
  timing: TrialTiming;
  failures: OutcomeRule[];
}

function readTrials(
  workspace: AuthoringWorkspace,
  plan: AgentEvalPlan,
  intake: AgentIntake,
): TrialRecord[] {
  const trials = workspace.readJson<AgentTrial[]>(`iteration-${plan.iteration}/trials.json`) ?? [];
  const records: TrialRecord[] = [];
  for (const trial of trials) {
    const rel = trial.workdir.slice(workspace.rel.length + 1);
    if (!workspace.exists(rel)) {
      throw new AuthoringRefusal(
        `The trial ${trial.custom_id} is missing: ${trial.workdir} does not exist. Each arm needs ${PASS_K} trials per tier.`,
      );
    }
    if (!workspace.exists(`${rel}/outputs`)) {
      throw new AuthoringRefusal(
        `The trial ${trial.custom_id} has no outputs/ in ${trial.workdir}.`,
      );
    }
    const timing = readTiming(workspace, trial, rel);
    const grading = readGrading(workspace, trial, rel);
    const agentCase = plan.cases.find((entry) => entry.name === trial.case)!;
    const failures = outcomeFailures({
      grading,
      timing,
      agentCase,
      intake,
      stageAgent: plan.stage_agent,
    });
    const assertions = [
      ...grading.assertions.map((entry) => ({ text: entry.text, passed: entry.passed })),
      ...failures.map((entry) => ({ text: entry.text, passed: false })),
    ];
    const passed = assertions.filter((entry) => entry.passed === true).length;
    records.push({
      trial,
      timing,
      failures,
      run: {
        case: trial.case,
        arm: trial.arm,
        tier: trial.tier,
        run: trial.trial,
        model: trial.model,
        assertions,
        passed,
        total: assertions.length,
        tokens: timing.tokens,
        duration_ms: timing.duration_ms,
        cost_usd: timing.cost_usd,
        cache_hit_share: timing.cache_hit_share,
        max_tool_result_tokens: timing.max_tool_result_tokens,
        truncated: false,
        cut_off: timing.max_turns_hit || timing.spend_cap_hit,
      },
    });
  }
  return records;
}

function medianOrNull(values: readonly Measured[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return median(values as number[]);
}

function armMetrics(
  records: readonly TrialRecord[],
  reliability: Reliability | undefined,
): AgentArmMetrics {
  return {
    pass_hat_k: reliability?.pass_hat_k ?? 0,
    tokens_median: medianOrNull(records.map((entry) => entry.timing.tokens)),
    cost_median: medianOrNull(records.map((entry) => entry.timing.cost_usd)),
    latency_ms:
      records.length === 0
        ? null
        : latencyMeasure(records.map((entry) => entry.timing.duration_ms)).value,
  };
}

const TRIAL_SOURCES: readonly EvalAdapter[] = ['claude-plugin-eval', 'subagent-dispatch'];

function trialSource(value: unknown): EvalAdapter | null {
  return (TRIAL_SOURCES as readonly unknown[]).includes(value) ? (value as EvalAdapter) : null;
}

export function recordedTrialSource(
  records: ReadonlyArray<{ timing: Pick<TrialTiming, 'source'> }>,
  planned: string,
): string {
  const named = [...new Set(records.map((entry) => entry.timing.source ?? planned))].sort();
  return named.length === 0 ? planned : named.join('+');
}

function performance(records: readonly TrialRecord[], adapter: string) {
  const label = (values: readonly Measured[]) => {
    const value = medianOrNull(values);
    return value === null
      ? { value: 'unavailable' as const, source: adapter }
      : { value, source: adapter };
  };
  const latency = latencyMeasure(records.map((entry) => entry.timing.duration_ms));
  return {
    tokens_per_task: label(records.map((entry) => entry.timing.tokens)),
    cost_usd: label(records.map((entry) => entry.timing.cost_usd)),
    latency_p50_ms: {
      value: median(records.map((entry) => entry.timing.duration_ms)),
      source: adapter,
    },
    latency_p95_ms: {
      value: latency.value,
      measure: latency.measure,
      samples: latency.samples,
      source: adapter,
    },
    queue_ms_median: {
      value: median(records.map((entry) => entry.timing.queue_ms)),
      source: adapter,
    },
    cache_hit_share: label(records.map((entry) => entry.timing.cache_hit_share)),
    tool_calls: label(records.map((entry) => entry.timing.tool_calls)),
    tool_use_blocks_per_message: label(
      records.map((entry) => entry.timing.tool_use_blocks_per_message),
    ),
    turns: label(records.map((entry) => entry.timing.turns)),
    returned_to_main_tokens: label(records.map((entry) => entry.timing.returned_to_main_tokens)),
    context_utilisation: { value: 'unavailable' as const, source: adapter },
  };
}

export interface AgentAnalyst {
  tool_use_blocks_per_message: number | null;
  tool_use_blocks_below_floor: boolean;
  cache_hit_share: number | null;
  cache_hit_below_min: boolean;
  oversize_tool_results: string[];
  performance_defects: string[];
  cut_off: string[];
}

export function agentAnalyst(input: {
  records: readonly TrialRecord[];
  independentCalls: boolean;
  cacheHitMin: number;
  toolResultMaxTokens: number;
  baselineArm: EvalArm;
}): AgentAnalyst {
  const agent = input.records.filter((entry) => entry.run.arm === 'with_agent');
  const facts = analystFacts({
    runs: agent.map((entry) => entry.run),
    baselineArm: input.baselineArm,
    withArm: 'with_agent',
    cacheHitMin: input.cacheHitMin,
    toolResultMaxTokens: input.toolResultMaxTokens,
  });
  const blocks = agent
    .map((entry) => entry.timing.tool_use_blocks_per_message)
    .filter((value): value is number => value !== null);
  const blocksMean =
    blocks.length === 0
      ? null
      : Math.round((blocks.reduce((sum, value) => sum + value, 0) / blocks.length) * 1000) / 1000;
  const below =
    input.independentCalls &&
    blocksMean !== null &&
    !meetsThreshold(blocksMean, TOOL_USE_BLOCKS_FLOOR);
  const defects: string[] = [];
  if (below) {
    defects.push(
      `tool-use blocks per tool-calling message is ${blocksMean}, below the floor of ${TOOL_USE_BLOCKS_FLOOR} for independent calls`,
    );
  }
  if (facts.cache_hit_below_min) {
    defects.push(
      `steady-state cache-hit share is ${facts.cache_hit_share}, below authoring_cache_hit_min (${input.cacheHitMin})`,
    );
  }
  for (const run of facts.oversize_tool_results) {
    const record = agent.find(
      (entry) =>
        `${entry.run.case} / ${entry.run.arm} / ${entry.run.tier} / run-${entry.run.run}` === run,
    );
    defects.push(
      `${run} returned a tool result of ${record?.timing.max_tool_result_tokens} tokens, above authoring_tool_result_max_tokens (${input.toolResultMaxTokens})`,
    );
  }
  return {
    tool_use_blocks_per_message: blocksMean,
    tool_use_blocks_below_floor: below,
    cache_hit_share: facts.cache_hit_share,
    cache_hit_below_min: facts.cache_hit_below_min,
    oversize_tool_results: facts.oversize_tool_results,
    performance_defects: defects,
    cut_off: agent.filter((entry) => entry.run.cut_off).map((entry) => entry.trial.custom_id),
  };
}

export function notAddedLine(name: string, gate: string): string {
  return (
    `I couldn't get the agent ${name} through its ${gate} check, so I didn't add it. ` +
    "The change continues without it: drop the plan step that lists its file. This is paqad's to fix, not yours."
  );
}

export interface AgentEvalRecordOptions {
  change?: string | null;
  previous?: AgentArmMetrics | null;
}

export async function runAgentEvalRecord(
  workspace: AuthoringWorkspace,
  options: AgentEvalRecordOptions = {},
): Promise<StageResult> {
  requireEarlierGates(workspace, 'S5');
  const iteration = latestAgentIteration(workspace);
  const plan =
    iteration === null
      ? null
      : workspace.readJson<AgentEvalPlan>(`iteration-${iteration}/${AGENT_PLAN_FILE}`);
  if (plan === null) {
    throw new AuthoringRefusal(
      `There is no planned iteration. Run paqad-ai agent eval plan ${workspace.name} first.`,
    );
  }
  const iterDir = `iteration-${plan.iteration}`;
  if (workspace.exists(`${iterDir}/benchmark.json`)) {
    throw new AuthoringRefusal(
      `Iteration ${plan.iteration} is already recorded. Revise the agent and run paqad-ai agent eval plan ${workspace.name} --lever <lever> for the next one.`,
    );
  }
  const intake = requireIntake(workspace);
  const config = readAuthoringConfig(workspace.projectRoot);
  const records = readTrials(workspace, plan, intake);
  const outcomes = records.map((entry) => ({
    case: entry.run.case,
    arm: entry.run.arm,
    tier: entry.run.tier,
    passed: trialPassed(entry.run),
  }));
  const reliability = reliabilityTable(outcomes);
  const summary = aggregateBenchmark(
    records.map((entry) => entry.run),
    plan.baseline_arm,
    'with_agent',
  );
  const threshold = plan.stage_agent
    ? config.agent_stage_pass_k_threshold
    : config.agent_pass_k_threshold;
  const comparison = workspace.readJson<{ cases?: Array<{ preferred?: unknown }> }>(
    `${iterDir}/comparison.json`,
  );
  const subjective = Array.isArray(comparison?.cases)
    ? {
        preferred: comparison.cases.map((entry) =>
          entry.preferred === 'new' || entry.preferred === 'old'
            ? (entry.preferred as 'new' | 'old')
            : ('tie' as const),
        ),
      }
    : null;
  const find = (arm: EvalArm, tier: string) =>
    reliability.find((entry) => entry.arm === arm && entry.tier === tier);
  const of = (arm: EvalArm, tier: string) =>
    records.filter((entry) => entry.run.arm === arm && entry.run.tier === tier);
  const previous = options.previous ?? null;
  const tiers = plan.tiers.map((tier) => {
    const agent = armMetrics(of('with_agent', tier.tier), find('with_agent', tier.tier));
    const baseline = armMetrics(
      of(plan.baseline_arm, tier.tier),
      find(plan.baseline_arm, tier.tier),
    );
    const gate = judgeAgentS5Gate({
      agent,
      baseline,
      passKThreshold: threshold,
      minGainPoints: config.skill_eval_min_gain_points,
      maxCostMultiple: config.agent_max_cost_multiple,
      parallelWallTimeGain:
        intake.parallel &&
        agent.latency_ms !== null &&
        baseline.latency_ms !== null &&
        agent.latency_ms < baseline.latency_ms,
      edited:
        plan.baseline_arm === 'old_agent'
          ? { previous: previous ?? baseline, tolerance: config.authoring_regression_tolerance }
          : null,
      subjective,
    });
    const memory = plan.arms.includes('with_agent_memory')
      ? memoryDecision({
          withAgent: agent,
          withMemory: armMetrics(
            of('with_agent_memory', tier.tier),
            find('with_agent_memory', tier.tier),
          ),
          tokenTolerance: config.authoring_regression_tolerance,
        })
      : null;
    return { tier: tier.tier, model: tier.model, agent, baseline, gate, memory };
  });
  const order = plan.tiers.map((tier) => tier.tier);
  const registered = cheapestPassingTier(
    tiers.map((entry) => ({ tier: entry.tier, passed: entry.gate.passed })),
    order,
  );
  const passed = registered !== null;
  const chosen = tiers.find((entry) => entry.tier === (registered ?? order.at(-1)))!;
  const independentCalls = (workspace.read(agentDraftFile(workspace)) ?? '').includes(
    INDEPENDENT_CALLS_LINE,
  );
  const analyst = agentAnalyst({
    records,
    independentCalls,
    cacheHitMin: config.authoring_cache_hit_min,
    toolResultMaxTokens: config.authoring_tool_result_max_tokens,
    baselineArm: plan.baseline_arm,
  });
  const history = [...iterationNumbers(workspace)]
    .filter((number) => number < plan.iteration)
    .map((number) =>
      workspace.readJson<{ passed?: boolean; pass_hat_k?: number }>(
        `iteration-${number}/benchmark.json`,
      ),
    )
    .map((entry, index) => ({
      iteration: index + 1,
      passed: entry?.passed === true,
      pass_rate_with: entry?.pass_hat_k ?? 0,
    }));
  const loop = await iterationLoopVerdict(
    [...history, { iteration: plan.iteration, passed, pass_rate_with: chosen.agent.pass_hat_k }],
    config.authoring_max_iterations,
  );
  const spentUsd =
    Math.round(records.reduce((sum, entry) => sum + (entry.timing.cost_usd ?? 0), 0) * 1e6) / 1e6;
  const spend = recordSpend(workspace, `S5-iteration-${plan.iteration}`, spentUsd, options.change);
  const agentRecords = records.filter((entry) => entry.run.arm === 'with_agent');
  const batched = records.filter((entry) => entry.timing.batched).length;
  const fellBack = records.filter((entry) => entry.timing.fell_back).length;
  const benchmark = {
    gate: passed ? 'passed' : 'failed',
    stage: 'S5',
    ...(passed ? {} : { reason: chosen.gate.reasons.join('; ') || 'no tier passed' }),
    iteration: plan.iteration,
    lever: plan.lever,
    adapter: plan.adapter.adapter,
    trial_source: recordedTrialSource(records, plan.adapter.adapter),
    passed,
    pass_hat_k: chosen.agent.pass_hat_k,
    threshold,
    baseline_arm: plan.baseline_arm,
    arms: plan.arms,
    sample_size: { trials_per_arm: PASS_K, cases: plan.cases.length },
    reliability,
    summary,
    tiers: tiers.map((entry) => ({
      tier: entry.tier,
      model: entry.model,
      passed: entry.gate.passed,
      no_gain: entry.gate.no_gain,
      reasons: entry.gate.reasons,
      checks_not_measured: entry.gate.checks_not_measured,
      with_agent: entry.agent,
      baseline: entry.baseline,
    })),
    registered_tier: registered,
    registered_model: registered === null ? null : chosen.model,
    memory: chosen.memory,
    analyst,
    forms: [...new Set(agentRecords.map((entry) => entry.timing.form))],
    unenforced_rules: [...new Set(agentRecords.flatMap((entry) => entry.timing.unenforced_rules))],
    performance: performance(agentRecords, recordedTrialSource(records, plan.adapter.adapter)),
    batch:
      plan.batch === 'available'
        ? { requests_batched: batched, fell_back: fellBack, saving_usd: 'unavailable' }
        : 'unavailable',
    loop,
    stop_reason: loop.status === 'continue' ? null : loop.reason,
    creation_cost_usd: { S5: spentUsd },
    spend,
    inputs_hash: draftAgentHashWithoutDescription(workspace),
  };
  workspace.writeJson(`${iterDir}/benchmark.json`, benchmark);
  const artifact = workspace.writeJson('benchmark.json', benchmark);
  const lines = [
    `Iteration ${plan.iteration}: pass^3 ${chosen.agent.pass_hat_k} (pass@3 ${find('with_agent', chosen.tier)?.pass_at_k ?? 0}) on the ${chosen.tier} tier against ${plan.baseline_arm} ${chosen.baseline.pass_hat_k}.`,
    ...analyst.performance_defects.map((defect) => `Performance defect: ${defect}.`),
  ];
  if (spend.raised) {
    lines.push(
      `Spend reached the worst case of $${spend.worst_case_usd}; decision ${spend.decision} asks whether to continue.`,
    );
  }
  if (passed) {
    lines.push(
      `S5 passed on the ${registered} tier (${chosen.model}), the cheapest that passed.`,
      intake.invocation === 'dispatched'
        ? `Next: paqad-ai agent delegation plan ${workspace.name} (dispatched agents skip S6).`
        : `Next: paqad-ai agent delegation plan ${workspace.name} <requests.json>`,
    );
    return { ok: true, artifacts: [artifact], lines };
  }
  lines.push(`S5 failed: ${chosen.gate.reasons.join('; ')}.`);
  if (loop.status === 'stopped') {
    const onlyNoGain = chosen.gate.no_gain && meetsThreshold(chosen.agent.pass_hat_k, threshold);
    const gateName = onlyNoGain ? 'no gain' : 'S5 reliability';
    if (!onlyNoGain || plan.stage_agent) {
      recordGateFailure(workspace.projectRoot, {
        skill: workspace.name,
        gate: 'S5',
        evidencePath: artifact,
        kind: 'agent',
      });
    }
    lines.push(`The loop stopped: ${loop.reason}.`, notAddedLine(workspace.name, gateName));
    return { ok: false, stopped: true, artifacts: [artifact], lines };
  }
  lines.push(
    `Revise the agent in this order: ${REVISION_LEVERS.join(', ')}${analyst.cut_off.length > 0 ? ' (a trial was cut off, so start with stopping)' : ''}, rerun paqad-ai agent draft, then paqad-ai agent eval plan ${workspace.name} --lever <lever>.`,
  );
  return { ok: false, artifacts: [artifact], lines };
}
