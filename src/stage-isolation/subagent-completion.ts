import { readFileSync } from 'node:fs';

import { readTranscriptUsage } from '@/cost/transcript-usage.js';
import { appendFeatureStageRow, currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveHookSession } from '@/rag-ledger/session.js';
import { recordHighTableUsage } from '@/spec-pipeline/high-table.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

import { stageForAgentName, stripPluginAgentNamespace } from './stage-agents.js';
import { readStageSetting } from './stage-settings.js';

export { recordHighTableUsage };

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

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
    appendFeatureStageRow(
      input.projectRoot,
      sessionId,
      dirName,
      {
        kind: STAGE_AGENT_KIND,
        stage,
        agent: input.payload.agent_type,
        tokens_used: tokens.tokens_used,
        tokens_not_recarried: tokens.tokens_not_recarried,
        estimate: !tokens.exact,
        ...(readStageSetting(input.projectRoot, sessionId, stage) ?? {}),
      },
      input.now,
    );
    return true;
  } catch {
    return false;
  }
}
