import { randomUUID } from 'node:crypto';

import { sha256Hex } from '@/compliance/markdown.js';
import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { resolveHookSession } from '@/rag-ledger/session.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { STAGE_AGENT_KIND, STAGE_HANDBACK_KIND } from '@/stage-evidence/types.js';

import {
  agentNameForStage,
  readStageReportStatus,
  stageForAgentName,
  stripPluginAgentNamespace,
  type StageReportReading,
  type StageReportStatus,
} from './stage-agents.js';

export const REFUSAL_CEILING = 3;

const RIGID_ARTIFACT: Readonly<Record<string, string>> = {
  planning: 'plan.json',
  specification: 'specification.json',
  review: 'review.json',
  checks: 'checks.json',
};

type Row = SessionLedgerRow;

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function stageEndCommand(stage: string): string {
  const agent = `--agent ${agentNameForStage(stage)}`;
  const artifact = RIGID_ARTIFACT[stage];
  return artifact
    ? `paqad-ai stage end ${stage} ${agent} --artifact <the ${artifact} path>`
    : `paqad-ai stage end ${stage} ${agent}`;
}

export function missingRequirementReason(stage: string): string {
  const what = RIGID_ARTIFACT[stage] ? 'its artifact' : 'its stage end row';
  return `${stage} ended without ${what}; run \`${stageEndCommand(stage)}\` first`;
}

export function currentStageOfAgent(
  rows: readonly Row[],
  agentId: string | null,
  agentType: string | null,
): string | null {
  const started = agentId
    ? rows.filter((row) => row.kind === 'stage_start' && row.agent_id === agentId).at(-1)
    : undefined;
  const fromStart = started ? stringField(started.stage) : null;
  if (fromStart) return fromStart;
  return agentType ? stageForAgentName(stripPluginAgentNamespace(agentType.trim())) : null;
}

function requirementAnchor(rows: readonly Row[], stage: string, agentId: string | null): number {
  const findLast = (match: (row: Row) => boolean): number => rows.findLastIndex(match);
  const own = agentId
    ? findLast(
        (row) => row.kind === 'stage_start' && row.stage === stage && row.agent_id === agentId,
      )
    : -1;
  if (own !== -1) return own;
  return findLast((row) => row.kind === 'stage_start' && row.stage === stage);
}

function endRowProvesStage(row: Row, stage: string): boolean {
  if (row.kind !== 'stage_end' || row.stage !== stage) return false;
  const artifact = RIGID_ARTIFACT[stage];
  if (!artifact) return true;
  const paths = Array.isArray(row.artifact_paths) ? (row.artifact_paths as unknown[]) : [];
  const named = paths.some((path) => typeof path === 'string' && path.endsWith(artifact));
  return stringField(row.artifact_digest) !== null && named;
}

export function stageRequirementMet(
  rows: readonly Row[],
  stage: string,
  agentId: string | null,
): boolean {
  const anchor = requirementAnchor(rows, stage, agentId);
  return rows.slice(anchor + 1).some((row) => endRowProvesStage(row, stage));
}

function refusalId(row: Row): string {
  return stringField(row.tool_use_id) ?? stringField(row.refusal_id) ?? row.content_hash;
}

function isOwnNonDenied(row: Row, agentId: string, stage: string): boolean {
  if (row.agent_id !== agentId || row.stage !== stage) return false;
  if (row.kind === STAGE_AGENT_KIND) return true;
  return row.kind === STAGE_HANDBACK_KIND && row.event_status !== 'denied';
}

export function refusalsSinceLastPass(
  rows: readonly Row[],
  agentId: string | null,
  stage: string,
): Row[] {
  if (agentId === null) return [];
  const anchor = rows.findLastIndex((row) => isOwnNonDenied(row, agentId, stage));
  const denied = rows
    .slice(anchor + 1)
    .filter(
      (row) =>
        row.kind === STAGE_HANDBACK_KIND &&
        row.event_status === 'denied' &&
        row.agent_id === agentId &&
        row.stage === stage,
    );
  const seen = new Set<string>();
  return denied.filter((row) => {
    const id = refusalId(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export type ReportOutcome = 'pass' | 'refuse' | 'ceiling';

export interface ReportJudgement {
  outcome: ReportOutcome;
  report_status: StageReportStatus;
  report_stated: boolean;
  advance: boolean;
  decision: string | null;
  stated_status?: StageReportStatus;
  reason?: string;
}

export interface JudgeReportInput {
  stage: string;
  agentId: string | null;
  reading: StageReportReading;
  rows: readonly Row[];
  checksRed?: boolean;
  violations?: readonly string[];
}

export function judgeStageReport(input: JudgeReportInput): ReportJudgement {
  const { reading, stage, agentId, rows } = input;
  const settled = {
    report_status: reading.status,
    report_stated: reading.stated,
    decision: reading.decision,
  };
  if (!reading.stated || reading.decision !== null || !reading.advance) {
    return { outcome: 'pass', ...settled, advance: false };
  }
  if (stageRequirementMet(rows, stage, agentId)) {
    const clean = input.checksRed !== true && (input.violations?.length ?? 0) === 0;
    return { outcome: 'pass', ...settled, advance: clean };
  }
  const reason = missingRequirementReason(stage);
  if (refusalsSinceLastPass(rows, agentId, stage).length >= REFUSAL_CEILING) {
    return {
      outcome: 'ceiling',
      report_status: 'BLOCKED',
      report_stated: true,
      advance: false,
      decision: null,
      stated_status: reading.status,
      reason: `refused ${REFUSAL_CEILING} times: ${reason}`,
    };
  }
  return {
    outcome: 'refuse',
    ...settled,
    advance: false,
    stated_status: reading.status,
    reason,
  };
}

export interface HandbackPayload {
  agent_id?: unknown;
  agent_type?: unknown;
  session_id?: unknown;
  tool_use_id?: unknown;
  tool_input?: { message?: unknown } | null;
}

export interface HandbackDecision {
  exit: 0 | 2;
  reason?: string;
  wrote: boolean;
}

export interface DecideHandbackInput {
  projectRoot: string;
  payload: HandbackPayload;
  now?: () => Date;
}

const PASS_WITHOUT_ROW: HandbackDecision = { exit: 0, wrote: false };

function agentKnownToLedger(rows: readonly Row[], agentId: string): boolean {
  return rows.some(
    (row) =>
      row.agent_id === agentId && (row.kind === STAGE_AGENT_KIND || row.kind === 'stage_start'),
  );
}

export function decideHandback(input: DecideHandbackInput): HandbackDecision {
  const { payload, projectRoot, now } = input;
  const agentType = stringField(payload.agent_type);
  const agentId = stringField(payload.agent_id);
  if (!agentType || !agentId) return PASS_WITHOUT_ROW;
  if (!stageForAgentName(stripPluginAgentNamespace(agentType))) return PASS_WITHOUT_ROW;
  const sessionId = resolveHookSession(projectRoot, payload);
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) return PASS_WITHOUT_ROW;
  const rows = readFeatureStageUnit(projectRoot, dirName);
  if (!agentKnownToLedger(rows, agentId)) return PASS_WITHOUT_ROW;
  const stage = currentStageOfAgent(rows, agentId, agentType);
  if (!stage) return PASS_WITHOUT_ROW;
  const message = typeof payload.tool_input?.message === 'string' ? payload.tool_input.message : '';
  const reading = readStageReportStatus(message);
  const judged = judgeStageReport({
    stage,
    agentId,
    reading,
    rows,
    checksRed: isChecksRed(projectRoot, dirName, stage),
  });
  const toolUseId = stringField(payload.tool_use_id);
  appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    {
      kind: STAGE_HANDBACK_KIND,
      stage,
      agent: agentNameForStage(stage),
      agent_id: agentId,
      event_status: judged.outcome === 'refuse' ? 'denied' : 'completed',
      report_status: judged.report_status,
      report_stated: judged.report_stated,
      advance: judged.advance,
      decision: judged.decision,
      report_source: 'handback',
      report_hash: sha256Hex(message),
      ...(toolUseId ? { tool_use_id: toolUseId } : { refusal_id: randomUUID() }),
      ...(judged.stated_status ? { stated_status: judged.stated_status } : {}),
      ...(judged.reason ? { reason: judged.reason } : {}),
    },
    now,
  );
  return judged.outcome === 'refuse'
    ? { exit: 2, reason: judged.reason!, wrote: true }
    : { exit: 0, wrote: true };
}

export function isChecksRed(_projectRoot: string, _dirName: string, _stage: string): boolean {
  return false;
}
