import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { toPosixPath } from '@/core/path-utils.js';
import { GATE_CATALOG, type GateCode } from '@/core/types/verification.js';
import { GATE_STATE_LABEL, type GateState } from '@/evidence/grading.js';
import { readFeatureChecks } from '@/checks/report-store.js';
import {
  readFeaturePlan,
  readFeatureReview,
  readFeatureSpecification,
} from '@/feature-evidence/artifacts.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { laneStages } from '@/stage-evidence/stages.js';
import type { StageLane } from '@/stage-evidence/types.js';

export type HudProofStepState = 'done' | 'failed' | 'not-yet';

export interface HudProofStep {
  id: string;
  words: string;
  detail: string | null;
  state: HudProofStepState;
}

export type HudProofGateState = GateState | 'not-judged';

export interface HudProofGate {
  code: string;
  words: string;
  state: HudProofGateState;
}

export interface HudStageProof {
  stage: string;
  words: string;
  state: string;
  steps: HudProofStep[];
  gates: HudProofGate[];
}

export const PROOF_GATE_WORDS: Readonly<Record<HudProofGateState, string>> = {
  ...GATE_STATE_LABEL,
  'not-judged': 'Not judged yet',
};

export interface StageProofGateRow {
  name: string;
  verdict: string;
}

export interface StageProofInput {
  lane: string | null;
  stages: ReadonlyArray<{ stage: string; state: string }>;
  gates: readonly StageProofGateRow[];
  judged: boolean;
  plan: { steps: number; reuse: number | null } | null;
  planProgress: { steps: number; done: number } | null;
  spec: { grounded: number | null; criteria: number; frozen: boolean } | null;
  experts: number | null;
  questions: { asked: number; answered: number; auto_answered: number; deferred: number } | null;
  rules: number | null;
  changedFiles: readonly string[] | null;
  review: { findings: number } | null;
  checks: { passed: boolean; commands: number; failed: number } | null;
  siteMap: boolean;
}

const PROOF_STAGE_WORDS: Readonly<Record<string, string>> = {
  planning: 'Plan',
  specification: 'Spec',
  development: 'Build',
  review: 'Review',
  checks: 'Checks',
  documentation_sync: 'Docs',
};

const JUDGED_STATES: ReadonlySet<string> = new Set(Object.keys(GATE_STATE_LABEL));

const FINISHED_STAGES: ReadonlySet<string> = new Set(['complete', 'redone']);

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function step(
  id: string,
  words: string,
  detail: string | null,
  state: HudProofStepState,
): HudProofStep {
  return { id, words, detail, state };
}

function stageFinished(input: StageProofInput, stage: string): boolean {
  const found = input.stages.find((entry) => entry.stage === stage);
  return found !== undefined && FINISHED_STAGES.has(found.state);
}

function planSteps(input: StageProofInput): HudProofStep[] {
  const plan = input.plan;
  const reuse = plan?.reuse ?? null;
  return [
    plan
      ? step('plan', 'Plan compiled', count(plan.steps, 'step', 'steps'), 'done')
      : step('plan', 'Plan compiled', null, 'not-yet'),
    reuse !== null && reuse > 0
      ? step(
          'reuse',
          'Reuse checked',
          count(reuse, 'source consulted', 'sources consulted'),
          'done',
        )
      : step('reuse', 'Reuse checked', null, 'not-yet'),
  ];
}

function questionsStep(input: StageProofInput): HudProofStep {
  const questions = input.questions;
  if (!questions) return step('questions', 'Questions answered', null, 'not-yet');
  if (questions.asked === 0) return step('questions', 'Questions answered', 'none asked', 'done');
  const answered = questions.answered + questions.auto_answered;
  return step(
    'questions',
    'Questions answered',
    `${answered} of ${questions.asked}`,
    answered >= questions.asked ? 'done' : 'not-yet',
  );
}

function specSteps(input: StageProofInput): HudProofStep[] {
  const spec = input.spec;
  const grounded = spec?.grounded ?? null;
  const frozen = spec?.frozen === true || stageFinished(input, 'specification');
  return [
    grounded !== null && grounded > 0
      ? step('grounded', 'Grounded in the code', count(grounded, 'reference', 'references'), 'done')
      : step('grounded', 'Grounded in the code', null, 'not-yet'),
    input.experts !== null && input.experts > 0
      ? step('experts', 'Experts seated', count(input.experts, 'expert', 'experts'), 'done')
      : step('experts', 'Experts seated', null, 'not-yet'),
    questionsStep(input),
    step(
      'frozen',
      'Spec frozen',
      spec ? count(spec.criteria, 'criterion', 'criteria') : null,
      frozen ? 'done' : 'not-yet',
    ),
  ];
}

function buildSteps(input: StageProofInput): HudProofStep[] {
  const files = input.changedFiles ?? [];
  const progress = input.planProgress;
  return [
    input.rules !== null
      ? step('rules', 'Rules loaded', count(input.rules, 'rule applies', 'rules apply'), 'done')
      : step('rules', 'Rules loaded', null, 'not-yet'),
    files.length > 0
      ? step('edits', 'Edits made', count(files.length, 'file changed', 'files changed'), 'done')
      : step('edits', 'Edits made', null, 'not-yet'),
    ...(progress
      ? [
          step(
            'built',
            'Plan steps built',
            `${progress.done} of ${progress.steps}`,
            progress.done >= progress.steps ? 'done' : 'not-yet',
          ),
        ]
      : []),
  ];
}

function reviewSteps(input: StageProofInput): HudProofStep[] {
  const review = input.review;
  return [
    review
      ? step('review', 'Review recorded', count(review.findings, 'finding', 'findings'), 'done')
      : step('review', 'Review recorded', null, 'not-yet'),
  ];
}

function checksSteps(input: StageProofInput): HudProofStep[] {
  const checks = input.checks;
  if (!checks) return [step('checks', 'Checks run', null, 'not-yet')];
  if (checks.passed) {
    return [
      step('checks', 'Checks passed', `${checks.commands} of ${checks.commands} commands`, 'done'),
    ];
  }
  return [
    step(
      'checks',
      'Checks failed',
      `${checks.failed} of ${checks.commands} commands failed`,
      'failed',
    ),
  ];
}

function docsSteps(input: StageProofInput): HudProofStep[] {
  const docs = (input.changedFiles ?? []).filter((file) =>
    toPosixPath(file).replace(/^\.\//, '').startsWith('docs/'),
  ).length;
  if (docs > 0) {
    return [step('docs', 'Docs updated', count(docs, 'file changed', 'files changed'), 'done')];
  }
  if (stageFinished(input, 'documentation_sync')) {
    return [step('docs', 'Docs checked', 'no doc needed a change', 'done')];
  }
  return [step('docs', 'Docs updated', null, 'not-yet')];
}

const STEPS: Readonly<Record<string, (input: StageProofInput) => HudProofStep[]>> = {
  planning: planSteps,
  specification: specSteps,
  development: buildSteps,
  review: reviewSteps,
  checks: checksSteps,
  documentation_sync: docsSteps,
};

function gateRuns(code: GateCode, input: StageProofInput, recorded: boolean): boolean {
  const entry = GATE_CATALOG[code];
  if (entry.owner !== 'work') return false;
  if (code === 'site-map-freshness') return input.siteMap;
  if (entry.backstop === 'late') return recorded;
  return entry.backstop !== 'none';
}

function gateOnLane(code: GateCode, lane: string | null): boolean {
  const lanes: readonly string[] = GATE_CATALOG[code].lanes;
  return lane === null || !['fast', 'graduated', 'full'].includes(lane) || lanes.includes(lane);
}

function gateState(row: StageProofGateRow | undefined, judged: boolean): HudProofGateState {
  if (!row) return judged ? 'did-not-run' : 'not-judged';
  return JUDGED_STATES.has(row.verdict) ? (row.verdict as GateState) : 'not-judged';
}

function stageGates(stage: string, input: StageProofInput): HudProofGate[] {
  const rows = new Map(input.gates.map((row) => [row.name, row]));
  return (Object.keys(GATE_CATALOG) as GateCode[])
    .filter(
      (code) =>
        GATE_CATALOG[code].stage === stage &&
        gateOnLane(code, input.lane) &&
        gateRuns(code, input, rows.has(code)),
    )
    .map((code) => ({
      code,
      words: GATE_CATALOG[code].label,
      state: gateState(rows.get(code), input.judged),
    }));
}

function knownLane(lane: string | null): StageLane {
  return lane === 'fast' || lane === 'graduated' || lane === 'full' ? lane : null;
}

export function buildStageProof(input: StageProofInput): HudStageProof[] {
  return laneStages(knownLane(input.lane)).map((stage) => ({
    stage,
    words: PROOF_STAGE_WORDS[stage] ?? stage,
    state: input.stages.find((entry) => entry.stage === stage)?.state ?? 'missing',
    steps: STEPS[stage]?.(input) ?? [],
    gates: stageGates(stage, input),
  }));
}

function readRecord(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function siteMapOn(projectRoot: string): boolean {
  try {
    return resolveFrameworkConfig(projectRoot).features.site_map === true;
  } catch {
    return false;
  }
}

export type StageProofEvidence = Pick<
  StageProofInput,
  'plan' | 'spec' | 'experts' | 'review' | 'checks' | 'siteMap'
>;

export function readStageProofEvidence(projectRoot: string, dirName: string): StageProofEvidence {
  const plan = readFeaturePlan(projectRoot, dirName);
  const spec = readFeatureSpecification(projectRoot, dirName);
  const review = readFeatureReview(projectRoot, dirName);
  const report = readFeatureChecks(projectRoot, dirName);
  const experts = readRecord(join(projectRoot, featureFilePath(dirName, 'experts')));
  const commands = Array.isArray(report?.commands) ? report.commands : [];
  return {
    plan: plan
      ? {
          steps: listLength(plan.steps) ?? 0,
          reuse: listLength((plan.reuse as { consulted?: unknown } | undefined)?.consulted),
        }
      : null,
    spec: spec
      ? {
          grounded: listLength(spec.grounding?.references),
          criteria: listLength(spec.acceptance_criteria) ?? 0,
          frozen: spec.frozen !== null && spec.frozen !== undefined,
        }
      : null,
    experts: listLength(experts?.roster),
    review: review ? { findings: listLength(review.findings) ?? 0 } : null,
    checks:
      report && report.ran
        ? {
            passed: report.passed,
            commands: commands.length,
            failed: commands.filter((command) => !command.passed).length,
          }
        : null,
    siteMap: siteMapOn(projectRoot),
  };
}
