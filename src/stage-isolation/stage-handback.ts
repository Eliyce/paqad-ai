import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Hex } from '@/compliance/markdown.js';
import { PATHS } from '@/core/constants/paths.js';
import { RESUME_HANDOVER_TOKENS } from '@/onboarding/narration-contract-writer.js';
import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { resolveHookSession } from '@/rag-ledger/session.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { bundleLedgerEra } from '@/stage-evidence/ledger-era.js';
import { extractAssistantText } from '@/stage-evidence/marker-parse.js';
import { readRepairedReports, REPORT_REPAIR_REASON } from '@/stage-evidence/report-repair.js';
import {
  STAGE_AGENT_KIND,
  STAGE_HANDBACK_KIND,
  type ReportSource,
} from '@/stage-evidence/types.js';

import {
  agentNameForStage,
  readStageReportStatus,
  stageForAgentName,
  stripPluginAgentNamespace,
  type StageReportReading,
  type StageReportStatus,
} from './stage-agents.js';
import { transcriptToolUses } from './must-not-judge.js';

export const REFUSAL_CEILING = 3;

const RIGID_ARTIFACT: Readonly<Record<string, string>> = {
  planning: 'plan.json',
  specification: 'specification.json',
  review: 'review.json',
  checks: 'checks.json',
};

type Row = SessionLedgerRow;

function lastIndexWhere(rows: readonly Row[], match: (row: Row) => boolean): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (match(rows[index]!)) return index;
  }
  return -1;
}

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
  const findLast = (match: (row: Row) => boolean): number => lastIndexWhere(rows, match);
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
  const anchor = lastIndexWhere(rows, (row) => isOwnNonDenied(row, agentId, stage));
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

export function isChecksRed(projectRoot: string, dirName: string, stage: string): boolean {
  if (stage !== 'checks') return false;
  try {
    const report = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'checks')), 'utf8'),
    ) as { passed?: unknown };
    return report.passed === false;
  } catch {
    return false;
  }
}

export interface StageReportJson {
  agent_id: string;
  stage: string | null;
  report_status: string;
  advance: boolean | null;
  decision: string | null;
  report_source: string;
  reason: string | null;
  tokens_not_recarried: number | null;
  resume_advice: 'resume' | 'dispatch-fresh';
  next_action: string;
}

function resumeAdvice(tokens: number | null): 'resume' | 'dispatch-fresh' {
  return tokens !== null && tokens > RESUME_HANDOVER_TOKENS ? 'dispatch-fresh' : 'resume';
}

export interface StageReportOptions {
  checksRed?: (stage: string) => boolean;
  decisionAnswered?: (decision: string) => boolean;
}

export function stageReportOptions(projectRoot: string, dirName: string): StageReportOptions {
  return {
    checksRed: (stage) => isChecksRed(projectRoot, dirName, stage),
    decisionAnswered: (decision) =>
      existsSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, `${decision}.json`)),
  };
}

function nextAction(
  report: Omit<StageReportJson, 'next_action'>,
  options: StageReportOptions,
): string {
  if (report.decision) {
    return options.decisionAnswered?.(report.decision)
      ? `resume the agent with the answer to ${report.decision}`
      : `present the decision ${report.decision} to the developer`;
  }
  if (report.report_source === 'legacy') return "read the stage's end row in stage-evidence.jsonl";
  if (report.advance === true) {
    return report.report_status === 'DONE_WITH_CONCERNS'
      ? 'continue, and carry the concerns to the receipt'
      : 'continue to the next stage';
  }
  if (report.report_status === 'NEEDS_CONTEXT') return 'resume the agent with what it names';
  if (report.report_source === 'none') {
    return 'resume the agent once, naming what is left; if it returns the same way, stop and tell the developer';
  }
  return report.reason
    ? 'stop and tell the developer the reason'
    : 'stop and tell the developer which stage stopped';
}

function withAction(
  report: Omit<StageReportJson, 'next_action'>,
  options: StageReportOptions = {},
): StageReportJson {
  return { ...report, next_action: nextAction(report, options) };
}

interface EndRowHold {
  reason: string;
  action: string;
}

function endRowHold(
  stage: string,
  rows: readonly (Row | undefined)[],
  options: StageReportOptions,
): EndRowHold | null {
  const breaches = rows.flatMap((row) => (Array.isArray(row?.must_not) ? row.must_not : []));
  if (breaches.length > 0) {
    return {
      reason: `no Status line, and the agent breached a must-not: ${[...new Set(breaches)].join(', ')}`,
      action: 'stop and tell the developer the reason',
    };
  }
  return options.checksRed?.(stage) === true
    ? {
        reason: 'no Status line, and the checks are red',
        action: 'resume the development agent to fix the failures, then run checks again',
      }
    : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildStageReport(
  rows: readonly Row[],
  agentId: string,
  options: StageReportOptions = {},
): StageReportJson | null {
  const own = rows.filter((row) => row.agent_id === agentId);
  const reported = own.filter(
    (row) =>
      row.kind === STAGE_HANDBACK_KIND ||
      (row.kind === STAGE_AGENT_KIND && row.event_status === 'completed'),
  );
  const newest = reported.at(-1);
  const completion = own
    .filter((row) => row.kind === STAGE_AGENT_KIND && row.event_status === 'completed')
    .at(-1);
  const tokens = numberField(completion?.tokens_not_recarried);
  const base = {
    agent_id: agentId,
    tokens_not_recarried: tokens,
    resume_advice: resumeAdvice(tokens),
  };
  if (!newest) {
    if (own.length === 0) return null;
    return {
      ...withAction({
        ...base,
        stage: stringField(own.at(-1)!.stage),
        report_status: 'UNKNOWN',
        advance: false,
        decision: null,
        report_source: 'none',
        reason: 'the agent is still running and has given no report',
      }),
      next_action: 'wait for the agent to return; if it has already returned, resume it once',
    };
  }
  const stage = stringField(newest.stage);
  const reason = stringField(newest.reason);
  const source = stringField(newest.report_source);
  if (source === null && newest.report_stated !== true) {
    return withAction({
      ...base,
      stage,
      report_status: 'UNKNOWN',
      advance: null,
      decision: null,
      report_source: 'legacy',
      reason,
    });
  }
  const noClaim = source === 'none' || newest.report_stated !== true;
  const requirementMet = stage !== null && stageRequirementMet(rows, stage, agentId);
  const hold = stage === null ? null : endRowHold(stage, [newest, completion], options);
  const silentReturns = own.filter(
    (row) =>
      row.kind === STAGE_AGENT_KIND &&
      row.event_status === 'completed' &&
      row.report_stated !== true,
  ).length;
  const twiceSilent = `stop and tell the developer the ${stage ?? 'current'} stage returned twice with no report`;
  const held = (report: StageReportJson): StageReportJson =>
    hold === null
      ? report
      : { ...report, next_action: silentReturns >= 2 ? twiceSilent : hold.action };
  const repaired = noClaim
    ? readRepairedReports(rows).find((entry) => entry.agent_id === agentId)
    : undefined;
  if (repaired !== undefined) {
    const finished = repaired.report_status.startsWith('DONE');
    return held(
      withAction(
        {
          ...base,
          stage,
          report_status: repaired.report_status,
          advance: finished && requirementMet && hold === null,
          decision: null,
          report_source: repaired.source,
          reason: hold?.reason ?? REPORT_REPAIR_REASON,
        },
        options,
      ),
    );
  }
  if (noClaim && requirementMet) {
    return held(
      withAction(
        {
          ...base,
          stage,
          report_status: hold === null ? 'DONE' : 'DONE_WITH_CONCERNS',
          advance: hold === null,
          decision: null,
          report_source: source ?? 'none',
          reason: hold?.reason ?? "no Status line, and the stage's end row and result exist",
        },
        options,
      ),
    );
  }
  const report = withAction(
    {
      ...base,
      stage,
      report_status: noClaim ? 'BLOCKED' : String(newest.report_status),
      advance: newest.advance === true,
      decision: stringField(newest.decision),
      report_source: source ?? 'text',
      reason: reason ?? (noClaim ? 'the agent returned no report' : null),
    },
    options,
  );
  if (noClaim && silentReturns >= 2) return { ...report, next_action: twiceSilent };
  return newest.kind === STAGE_HANDBACK_KIND && newest.event_status === 'denied'
    ? {
        ...report,
        next_action:
          'wait for the agent: its handback was sent back and it can retry; if it has already returned, resume it once',
      }
    : report;
}

export function unknownAgentReport(agentId: string, reason: string): StageReportJson {
  return withAction({
    agent_id: agentId,
    stage: null,
    report_status: 'UNKNOWN',
    advance: false,
    decision: null,
    report_source: 'none',
    reason,
    tokens_not_recarried: null,
    resume_advice: 'resume',
  });
}

export interface StageRefusal {
  stage: string;
  message: string;
}

function reportedStage(rows: readonly Row[], index: number): string | null {
  const row = rows[index]!;
  const agentId = stringField(row.agent_id);
  if (agentId !== null) {
    const started = lastIndexWhere(
      rows.slice(0, index),
      (candidate) => candidate.kind === 'stage_start' && candidate.agent_id === agentId,
    );
    const stage = started === -1 ? null : stringField(rows[started]!.stage);
    if (stage !== null) return stage;
  }
  return stringField(row.stage);
}

function isStatedReport(row: Row): boolean {
  const reporting =
    row.kind === STAGE_HANDBACK_KIND
      ? row.event_status === 'completed'
      : row.kind === STAGE_AGENT_KIND && row.event_status === 'completed';
  return (
    reporting &&
    row.report_stated === true &&
    stringField(row.report_source) !== null &&
    row.report_source !== 'none'
  );
}

function newestReportIndex(rows: readonly Row[], stage: string): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (isStatedReport(rows[index]!) && reportedStage(rows, index) === stage) return index;
  }
  return -1;
}

function isUnfinishedReport(row: Row): boolean {
  return (
    row.report_status === 'BLOCKED' ||
    row.report_status === 'NEEDS_CONTEXT' ||
    stringField(row.decision) !== null
  );
}

function refusalMessage(
  stage: string,
  blocked: string,
  rows: readonly Row[],
  row: Row,
  options: StageReportOptions,
): string {
  const agentId = stringField(row.agent_id);
  const report = agentId ? buildStageReport(rows, agentId, options) : null;
  const status = stringField(row.decision) ?? String(row.report_status);
  const reason = stringField(row.reason);
  const next = report?.next_action ?? 'resume the stage agent';
  return (
    `${stage} cannot start: ${blocked} is unfinished (${status})` +
    `${reason ? `: ${reason}` : ''}. Next: ${next}.`
  );
}

export function stageStartRefusal(
  rows: readonly Row[],
  stage: string,
  lane: string | null,
  options: StageReportOptions = {},
): StageRefusal | null {
  if (lane === 'fast' || lane === 'graduated') return null;
  if (bundleLedgerEra(rows) !== 'v3') return null;
  const position = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  if (position === -1) return null;
  for (const earlier of STAGE_ORDER.slice(0, position)) {
    if (stage === 'documentation_sync' && earlier === 'review') continue;
    const index = newestReportIndex(rows, earlier);
    if (index === -1) continue;
    const row = rows[index]!;
    if (!isUnfinishedReport(row)) continue;
    if (rows.slice(index + 1).some((later) => endRowProvesStage(later, earlier))) continue;
    return { stage: earlier, message: refusalMessage(stage, earlier, rows, row, options) };
  }
  return null;
}

export const SUBAGENT_HANDBACK_TOOL = 'SubagentHandback';

export interface StopPayload extends HandbackPayload {
  agent_transcript_path?: unknown;
  last_assistant_message?: unknown;
}

export interface ResolvedReport {
  source: ReportSource;
  reading: StageReportReading;
  message: string | null;
  handbackRow: Row | null;
  gateChecked: boolean;
}

const NO_REPORT: StageReportReading = {
  status: 'BLOCKED',
  advance: false,
  decision: null,
  stated: false,
};

function isCompletedRowOf(row: Row, agentId: string): boolean {
  return (
    row.kind === STAGE_AGENT_KIND && row.event_status === 'completed' && row.agent_id === agentId
  );
}

function freshHandbackRow(rows: readonly Row[], agentId: string): Row | null {
  const previous = lastIndexWhere(rows, (row) => isCompletedRowOf(row, agentId));
  const newer = rows.slice(previous + 1);
  const index = lastIndexWhere(
    newer,
    (candidate) =>
      candidate.kind === STAGE_HANDBACK_KIND &&
      candidate.event_status === 'completed' &&
      candidate.agent_id === agentId,
  );
  return index === -1 ? null : newer[index]!;
}

function transcriptHandbackMessage(
  rows: readonly Row[],
  agentId: string,
  transcript: string,
): string | null {
  const known = new Set(
    rows
      .filter((row) => row.kind === STAGE_HANDBACK_KIND && row.agent_id === agentId)
      .map((row) => stringField(row.tool_use_id))
      .filter((id) => id !== null),
  );
  const finished = new Set(
    rows
      .filter((row) => isCompletedRowOf(row, agentId))
      .map((row) => stringField(row.report_hash))
      .filter((hash) => hash !== null),
  );
  const use = transcriptToolUses(transcript)
    .filter((entry) => entry.name === SUBAGENT_HANDBACK_TOOL)
    .at(-1);
  if (!use || (use.id !== undefined && known.has(use.id))) return null;
  const message = use.input.message;
  if (typeof message !== 'string' || finished.has(sha256Hex(message))) return null;
  return message;
}

function readTranscript(path: unknown): string {
  if (typeof path !== 'string' || path.trim() === '') return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export interface ResolveReportInput {
  rows: readonly Row[];
  agentId: string | null;
  payload: StopPayload;
  adapter: string;
  fallbackTranscript?: string;
}

function resolved(source: ReportSource, message: string, gateChecked = true): ResolvedReport {
  const reading = readStageReportStatus(message);
  return reading.stated
    ? { source, reading, message, handbackRow: null, gateChecked }
    : { source: 'none', reading, message, handbackRow: null, gateChecked };
}

export function resolveStageReport(input: ResolveReportInput): ResolvedReport {
  const { rows, agentId, payload, adapter } = input;
  const row = agentId ? freshHandbackRow(rows, agentId) : null;
  if (row) {
    const reading: StageReportReading = {
      status: row.report_status as StageReportStatus,
      advance: row.advance === true,
      decision: stringField(row.decision),
      stated: row.report_stated === true,
    };
    return { source: 'handback', reading, message: null, handbackRow: row, gateChecked: true };
  }
  const transcript = readTranscript(payload.agent_transcript_path);
  const handed = agentId ? transcriptHandbackMessage(rows, agentId, transcript) : null;
  if (handed !== null) return resolved('handback', handed, false);
  const finalText = payload.last_assistant_message;
  if (typeof finalText === 'string' && finalText.trim() !== '') return resolved('text', finalText);
  const codex = adapter === 'codex-cli';
  const raw = transcript !== '' ? transcript : codex ? (input.fallbackTranscript ?? '') : '';
  if (raw === '') {
    return {
      source: 'none',
      reading: NO_REPORT,
      message: null,
      handbackRow: null,
      gateChecked: true,
    };
  }
  return resolved(codex ? 'rollout' : 'text', extractAssistantText(raw));
}

export interface StopDecision {
  block: boolean;
  reason?: string;
}

export interface StageStopInput {
  projectRoot: string;
  payload: StopPayload;
  adapter: string;
  transcriptText?: string;
  now?: () => Date;
}

const LET_STOP: StopDecision = { block: false };

export function decideStageStop(input: StageStopInput): StopDecision {
  const { payload, projectRoot, adapter, now } = input;
  if (adapter === 'codex-cli') return LET_STOP;
  const agentType = stringField(payload.agent_type);
  const agentId = stringField(payload.agent_id);
  if (!agentType || !agentId) return LET_STOP;
  if (!stageForAgentName(stripPluginAgentNamespace(agentType))) return LET_STOP;
  const sessionId = resolveHookSession(projectRoot, payload);
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) return LET_STOP;
  const rows = readFeatureStageUnit(projectRoot, dirName);
  if (!agentKnownToLedger(rows, agentId)) return LET_STOP;
  const stage = currentStageOfAgent(rows, agentId, agentType);
  if (!stage) return LET_STOP;
  const report = resolveStageReport({
    rows,
    agentId,
    payload,
    adapter,
    fallbackTranscript: input.transcriptText,
  });
  if (report.handbackRow) return LET_STOP;
  const judged = judgeStageReport({ stage, agentId, reading: report.reading, rows });
  if (judged.outcome !== 'refuse') return LET_STOP;
  appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    {
      kind: STAGE_HANDBACK_KIND,
      stage,
      agent: agentNameForStage(stage),
      agent_id: agentId,
      event_status: 'denied',
      report_status: judged.report_status,
      report_stated: judged.report_stated,
      advance: false,
      decision: judged.decision,
      report_source: report.source,
      report_hash: sha256Hex(report.message ?? ''),
      refusal_id: randomUUID(),
      ...(judged.stated_status ? { stated_status: judged.stated_status } : {}),
      reason: judged.reason!,
    },
    now,
  );
  return { block: true, reason: judged.reason! };
}
