// Record-only SubagentStop handling for stage isolation (issue #567).
//
// When a paqad stage agent finishes, the host fires `SubagentStop` (matched to `^paqad-`),
// and the thin `runtime/hooks/stage-agent-completion.mjs` hook lazy-imports this module. It
// appends one `kind: 'stage-agent'` row to the bundle's `stage-evidence.jsonl` (issue #581
// retired the separate `context-efficiency.jsonl`): what the isolated stage cost and the
// carried history the orchestrator did not re-send. It NEVER blocks (SubagentStop blocking is
// undocumented on Claude) and never throws — a measurement failure must not disrupt a turn.

import { readFileSync } from 'node:fs';

import { readTranscriptUsage } from '@/cost/transcript-usage.js';
import { appendFeatureStageRow, currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveHookSession } from '@/rag-ledger/session.js';
import { recordHighTableUsage } from '@/spec-pipeline/high-table.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

import { stageForAgentName, stripPluginAgentNamespace } from './stage-agents.js';

export { recordHighTableUsage };

/** ~4 characters per token: the same rough estimate the issue specifies for the fallback. */
const CHARS_PER_TOKEN = 4;

/** Estimate a token count from text length (bytes/4), never negative. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Derive the feature-development stage a stage agent ran from its host agent type. A paqad
 * stage agent is named `paqad-<stage>` (e.g. `paqad-development`) as an npm install, and
 * `paqad:paqad-<stage>` when the Claude Code plugin supplies it (issue #616, Part 3). The optional
 * `paqad:` namespace is stripped first, then the `paqad-` prefix, so both forms derive the same
 * stage. Returns null for anything that is not a paqad stage agent, so a stray SubagentStop for
 * another agent records nothing (belt and braces behind the matcher).
 *
 * Issue #639, Part 13: only the six stage agents are stages. The `^(paqad:)?paqad-` matcher
 * also fires for the High Table seats (`paqad-expert`, `paqad-chief-architect`) and any other
 * `paqad-` name; none of them derives a stage, so none can add a `stage-agent` row.
 */
export function stageFromAgentType(agentType: string | null | undefined): string | null {
  if (typeof agentType !== 'string') {
    return null;
  }
  return stageForAgentName(stripPluginAgentNamespace(agentType));
}

/** The shape of a host `SubagentStop` payload this recorder reads (all fields optional). */
export interface SubagentStopPayload {
  agent_id?: unknown;
  agent_type?: unknown;
  session_id?: unknown;
  /** The subagent's own transcript (Claude Code), read for a High Table seat's exact tokens. */
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

/**
 * Read exact token counts from a payload `usage` object when the host surfaces one, else
 * estimate from the transcript. `cache_read_input_tokens` (Claude) and `cached_input_tokens`
 * (Codex) both name the cached slice, so either is accepted.
 */
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
  // No host usage — estimate from the subagent transcript and mark the row inexact.
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

function payloadSessionId(payload: SubagentStopPayload): string | null {
  return typeof payload.session_id === 'string' && payload.session_id.trim() !== ''
    ? payload.session_id.trim()
    : null;
}

export interface RecordStageAgentCompletionInput {
  projectRoot: string;
  payload: SubagentStopPayload;
  transcriptText: string;
  /** The host the stage agent ran on. The host lives on feature.json, never on the row. */
  adapter: string;
  /** Clock seam for tests. */
  now?: () => Date;
}

/**
 * Append one `stage-agent` row for a finished stage agent. Returns true when a row was
 * written, false when there was nothing to record (not a paqad stage agent, or no active
 * feature). Never throws — the caller is a non-blocking hook.
 */
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
      payloadSessionId(input.payload) ?? sessionId,
      dirName,
      {
        kind: STAGE_AGENT_KIND,
        stage,
        agent: input.payload.agent_type,
        tokens_used: tokens.tokens_used,
        tokens_not_recarried: tokens.tokens_not_recarried,
        estimate: !tokens.exact,
      },
      input.now,
    );
    return true;
  } catch {
    return false;
  }
}
