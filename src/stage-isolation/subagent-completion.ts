import { readFileSync } from 'node:fs';

import { estimateTokens } from '@/authoring/tokens.js';
import { readTranscriptUsage } from '@/cost/transcript-usage.js';
import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { resolveHookSession } from '@/rag-ledger/session.js';
import { recordHighTableUsage } from '@/spec-pipeline/high-table.js';
import { extractAssistantText, extractMarkers } from '@/stage-evidence/marker-parse.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';
import { sha256Hex } from '@/compliance/markdown.js';

import { judgeMustNot, transcriptToolUses } from './must-not-judge.js';
import {
  MANDATORY_STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  stageForAgentName,
  stripPluginAgentNamespace,
} from './stage-agents.js';
import {
  currentStageOfAgent,
  isChecksRed,
  judgeStageReport,
  resolveStageReport,
  type StopPayload,
} from './stage-handback.js';
import { readStageSetting } from './stage-settings.js';

export { recordHighTableUsage };

export { estimateTokens };

export function stageFromAgentType(agentType: string | null | undefined): string | null {
  if (typeof agentType !== 'string') {
    return null;
  }
  return stageForAgentName(stripPluginAgentNamespace(agentType));
}

export interface SubagentStopPayload {
  agent_id?: unknown;
  agent_type?: unknown;
  session_id?: unknown;
  agent_transcript_path?: unknown;
  last_assistant_message?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cached_input_tokens?: unknown;
  } | null;
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

interface TokenCounts {
  tokens_input: number;
  tokens_cached: number;
  tokens_output: number;
  exact: boolean;
}

export function resolveTokenCounts(
  payload: SubagentStopPayload,
  transcriptText: string,
): TokenCounts {
  const usage = payload.usage ?? undefined;
  const input = usage ? nonNegativeInt(usage.input_tokens) : null;
  const output = usage ? nonNegativeInt(usage.output_tokens) : null;
  if (input !== null && output !== null) {
    const cached =
      nonNegativeInt(usage?.cache_read_input_tokens) ??
      nonNegativeInt(usage?.cached_input_tokens) ??
      0;
    return { tokens_input: input, tokens_cached: cached, tokens_output: output, exact: true };
  }
  const estimate = estimateTokens(transcriptText);
  return { tokens_input: estimate, tokens_cached: 0, tokens_output: 0, exact: false };
}

export interface StageAgentTokens {
  tokens_used: number;
  tokens_not_recarried: number;
  exact: boolean;
}

function readAgentTranscriptText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function resolveStageAgentTokens(
  payload: SubagentStopPayload,
  transcriptText: string,
): StageAgentTokens {
  const path = payload.agent_transcript_path;
  if (typeof path === 'string' && path.trim() !== '') {
    const agentText = readAgentTranscriptText(path);
    const usage = readTranscriptUsage(path);
    if (agentText !== null && usage.messages.length > 0) {
      return {
        tokens_used: usage.totals.total,
        tokens_not_recarried: estimateTokens(agentText),
        exact: true,
      };
    }
  }
  const counts = resolveTokenCounts(payload, transcriptText);
  return {
    tokens_used: counts.tokens_input + counts.tokens_output,
    tokens_not_recarried: estimateTokens(transcriptText),
    exact: false,
  };
}

export interface RecordStageAgentCompletionInput {
  projectRoot: string;
  payload: SubagentStopPayload;
  transcriptText: string;
  adapter: string;
  now?: () => Date;
  log?: (line: string) => void;
}

function requestedSetting(
  projectRoot: string,
  sessionId: string,
  stage: string,
): { requested_effort?: string; requested_model?: string } {
  const setting = readStageSetting(projectRoot, sessionId, stage);
  return setting ? { requested_effort: setting.effort, requested_model: setting.model } : {};
}

function agentIdField(payload: SubagentStopPayload): { agent_id?: string } {
  return typeof payload.agent_id === 'string' && payload.agent_id.trim() !== ''
    ? { agent_id: payload.agent_id.trim() }
    : {};
}

function transcriptStartedStages(payload: SubagentStopPayload): string[] {
  const path = payload.agent_transcript_path;
  if (typeof path !== 'string' || path.trim() === '') return [];
  const text = readAgentTranscriptText(path);
  if (text === null) return [];
  return extractMarkers(extractAssistantText(text))
    .filter((marker) => marker.phase === 'start')
    .map((marker) => marker.stage);
}

function ledgerStartedStages(projectRoot: string, dirName: string, agentId: string): string[] {
  return readFeatureStageUnit(projectRoot, dirName)
    .filter((row) => row.kind === 'stage_start' && row.agent_id === agentId)
    .map((row) => String(row.stage));
}

export function stagesRunByAgent(
  projectRoot: string,
  dirName: string,
  stage: string,
  payload: SubagentStopPayload,
): string[] {
  const agentId = agentIdField(payload).agent_id;
  const ran = new Set([
    stage,
    ...transcriptStartedStages(payload),
    ...(agentId ? ledgerStartedStages(projectRoot, dirName, agentId) : []),
  ]);
  return STAGE_AGENT_STAGES.filter((candidate) => ran.has(candidate));
}

export interface StageAgentJudgement {
  report_status?: string;
  report_stated?: boolean;
  advance?: boolean;
  decision?: string | null;
  report_source?: string;
  report_hash?: string;
  stated_status?: string;
  reason?: string;
  gate_checked?: boolean;
  api_turns?: number;
  must_not?: string[];
}

function agentTurns(payload: SubagentStopPayload): number | null {
  const path = payload.agent_transcript_path;
  if (typeof path !== 'string' || path.trim() === '') return null;
  const usage = readTranscriptUsage(path);
  return usage.messages.length > 0 ? usage.messages.length : null;
}

function turnLimitReason(stage: string, turns: number | null): string | null {
  const limit = MANDATORY_STAGE_AGENTS.find((def) => def.ledgerStage === stage)?.maxTurns;
  return limit !== undefined && turns !== null && turns >= limit
    ? `${stage} reached its turn limit of ${limit} and returned no report`
    : null;
}

export interface JudgeStageAgentReturnInput {
  projectRoot: string;
  dirName: string;
  adapter: string;
  fallbackTranscript?: string;
}

export function judgeStageAgentReturn(
  stage: string,
  payload: SubagentStopPayload,
  context: JudgeStageAgentReturnInput,
): StageAgentJudgement {
  const rows = readFeatureStageUnit(context.projectRoot, context.dirName);
  const agentId = agentIdField(payload).agent_id ?? null;
  const report = resolveStageReport({
    rows,
    agentId,
    payload: payload as StopPayload,
    adapter: context.adapter,
    fallbackTranscript: context.fallbackTranscript,
  });
  const path = payload.agent_transcript_path;
  const text =
    typeof path === 'string' && path.trim() !== '' ? readAgentTranscriptText(path) : null;
  const violations = text === null ? [] : judgeMustNot(stage, transcriptToolUses(text));
  const current =
    currentStageOfAgent(
      rows,
      agentId,
      typeof payload.agent_type === 'string' ? payload.agent_type : null,
    ) ?? stage;
  const turns = agentTurns(payload);
  const row = report.handbackRow;
  const shared = {
    report_source: report.source,
    gate_checked: report.gateChecked,
    ...(turns === null ? {} : { api_turns: turns }),
    ...(violations.length > 0 ? { must_not: violations } : {}),
  };
  if (row) {
    return {
      ...shared,
      report_status: String(row.report_status),
      report_stated: row.report_stated === true,
      advance: row.advance === true && violations.length === 0,
      decision: typeof row.decision === 'string' ? row.decision : null,
      report_hash: String(row.report_hash),
      ...(typeof row.stated_status === 'string' ? { stated_status: row.stated_status } : {}),
      ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
    };
  }
  const judged = judgeStageReport({
    stage: current,
    agentId,
    reading: report.reading,
    rows,
    violations,
    checksRed: isChecksRed(context.projectRoot, context.dirName, current),
  });
  const turnLimit = report.source === 'none' ? turnLimitReason(current, turns) : null;
  const reason = judged.reason ?? turnLimit;
  return {
    ...shared,
    report_status: judged.report_status,
    report_stated: judged.report_stated,
    advance: judged.advance,
    decision: judged.decision,
    ...(report.message === null ? {} : { report_hash: sha256Hex(report.message) }),
    ...(judged.stated_status ? { stated_status: judged.stated_status } : {}),
    ...(reason ? { reason } : {}),
  };
}

export interface RecordStageAgentStartInput {
  projectRoot: string;
  payload: SubagentStopPayload;
  now?: () => Date;
}

export function recordStageAgentStart(input: RecordStageAgentStartInput): boolean {
  try {
    const agentType =
      typeof input.payload.agent_type === 'string' ? input.payload.agent_type : null;
    const stage = stageFromAgentType(agentType);
    if (!stage || agentType === null) {
      return false;
    }
    const sessionId = resolveHookSession(input.projectRoot, input.payload);
    const dirName = currentFeature(input.projectRoot, sessionId);
    if (!dirName) {
      return false;
    }
    appendFeatureStageRow(
      input.projectRoot,
      sessionId,
      dirName,
      {
        kind: STAGE_AGENT_KIND,
        stage,
        agent: agentType,
        ...agentIdField(input.payload),
        event_status: 'started',
        host_pid: process.ppid,
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      },
      input.now,
    );
    return true;
  } catch {
    return false;
  }
}

export function recordStageAgentCompletion(input: RecordStageAgentCompletionInput): boolean {
  try {
    const stage = stageFromAgentType(
      typeof input.payload.agent_type === 'string' ? input.payload.agent_type : null,
    );
    if (!stage) {
      return false;
    }
    const sessionId = resolveHookSession(input.projectRoot, input.payload);
    const dirName = currentFeature(input.projectRoot, sessionId);
    if (!dirName) {
      return false;
    }
    const tokens = resolveStageAgentTokens(input.payload, input.transcriptText);
    const stages = stagesRunByAgent(input.projectRoot, dirName, stage, input.payload);
    const judgement = judgeStageAgentReturn(stage, input.payload, {
      projectRoot: input.projectRoot,
      dirName,
      adapter: input.adapter,
      fallbackTranscript: input.transcriptText,
    });
    if (judgement.report_source === 'none') {
      input.log?.(
        `stage-agent-completion: no report found agent=${agentIdField(input.payload).agent_id ?? 'none'} stage=${stage}`,
      );
    }
    appendFeatureStageRow(
      input.projectRoot,
      sessionId,
      dirName,
      {
        kind: STAGE_AGENT_KIND,
        stage,
        ...(stages.length > 1 ? { stages } : {}),
        agent: input.payload.agent_type,
        ...agentIdField(input.payload),
        event_status: 'completed',
        tokens_used: tokens.tokens_used,
        tokens_not_recarried: tokens.tokens_not_recarried,
        estimate: !tokens.exact,
        ...requestedSetting(input.projectRoot, sessionId, stage),
        ...judgement,
      },
      input.now,
    );
    return true;
  } catch {
    return false;
  }
}
