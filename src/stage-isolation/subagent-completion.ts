// Record-only SubagentStop handling for stage isolation (issue #567).
//
// When a paqad stage agent finishes, the host fires `SubagentStop` (matched to `^paqad-`),
// and the thin `runtime/hooks/stage-agent-completion.mjs` hook lazy-imports this module. It
// appends one `context-efficiency.jsonl` row: what the isolated stage cost and the carried
// history the orchestrator did not re-send. It NEVER blocks (SubagentStop blocking is
// undocumented on Claude) and never throws — a measurement failure must not disrupt a turn.
//
// Token exactness is honest: `SubagentStop`'s usage payload is undocumented on both hosts,
// so when no usage object is present the counts are ESTIMATED from the subagent transcript
// (~4 chars per token) and `exact` is recorded as false. When a host later surfaces exact
// usage on the payload, it is used verbatim and `exact` is true. The row is keyed on the
// orchestrator's session id (the ledger cache the orchestrator aligned), so every row in the
// change shares one identity even though the subagent ran in its own context.

import { appendContextEfficiency } from '@/feature-evidence/bundle-ledgers.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

/** ~4 characters per token — the same rough estimate the issue specifies for the fallback. */
const CHARS_PER_TOKEN = 4;

/** The `paqad-` prefix every stage agent's name carries. */
const STAGE_AGENT_PREFIX = 'paqad-';

/** Estimate a token count from text length (bytes/4), never negative. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Derive the feature-development stage a stage agent ran from its host agent type. A paqad
 * stage agent is named `paqad-<stage>` (e.g. `paqad-development`), so the stage is the name
 * with the prefix stripped. Returns null for anything that is not a paqad stage agent, so a
 * stray SubagentStop for another agent records nothing (belt and braces behind the matcher).
 */
export function stageFromAgentType(agentType: string | null | undefined): string | null {
  if (typeof agentType !== 'string' || !agentType.startsWith(STAGE_AGENT_PREFIX)) {
    return null;
  }
  // Agent names use hyphens (`paqad-documentation-sync`); the ledger stage names use
  // underscores (`documentation_sync`, from STAGE_ORDER), so normalize to the canonical form.
  const stage = agentType.slice(STAGE_AGENT_PREFIX.length).trim().replace(/-/g, '_');
  return stage.length > 0 ? stage : null;
}

/** The shape of a host `SubagentStop` payload this recorder reads (all fields optional). */
export interface SubagentStopPayload {
  agent_id?: unknown;
  agent_type?: unknown;
  session_id?: unknown;
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

export interface RecordStageAgentCompletionInput {
  projectRoot: string;
  payload: SubagentStopPayload;
  transcriptText: string;
  adapter: string;
}

/**
 * Append one context-efficiency row for a finished stage agent. Returns true when a row was
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
    const agentId =
      typeof input.payload.agent_id === 'string' && input.payload.agent_id.length > 0
        ? input.payload.agent_id
        : 'unknown';
    // Key on the orchestrator's ledger session id (aligned at its SessionStart), NOT the
    // subagent's payload session_id, so every row in the change shares one identity. Passing
    // no hint reads the single-slot cache rather than clobbering it with the subagent's id.
    const sessionId = resolveSessionId(input.projectRoot, null);
    const counts = resolveTokenCounts(input.payload, input.transcriptText);
    const written = appendContextEfficiency(input.projectRoot, sessionId, {
      stage,
      agent_id: agentId,
      adapter: input.adapter,
      tokens_input: counts.tokens_input,
      tokens_cached: counts.tokens_cached,
      tokens_output: counts.tokens_output,
      exact: counts.exact,
      // The isolated stage's own footprint is history the orchestrator did not carry forward.
      // Always an estimate (the exact orchestrator-vs-single-context delta needs a run-mode
      // harness, an explicit follow-up), so it rides the row's inexact provenance too.
      carried_history_avoided_estimate: estimateTokens(input.transcriptText),
    });
    return written !== null;
  } catch {
    return false;
  }
}
