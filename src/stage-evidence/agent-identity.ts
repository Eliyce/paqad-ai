// Which agent produced a stage-evidence row (issue #573).
//
// Stage isolation (#567) says each mandatory stage runs in its own host subagent while the
// main chat stays a lean orchestrator. Nothing in the ledger recorded WHICH of those wrote a
// row, so an isolated run and a run that did everything inline were byte-for-byte
// indistinguishable after the fact — neither a reviewer nor a gate could tell them apart.
// That is the observability half of #573.
//
// The host tells us: a Claude subagent's hook payload carries `agent_type` (the agent's
// name, e.g. `paqad-development`) and `agent_id` (an opaque per-dispatch id). The main
// thread carries neither. This module is the one place that mapping lives, so no caller
// hand-rolls it (RULE-13 RL-3210).

/** Recorded on a row the main chat wrote itself, with no stage subagent in play. */
export const ORCHESTRATOR_AGENT = 'orchestrator';

/** The agent-identifying fields a host hook payload may carry. */
export interface AgentIdentityInput {
  /** The host's agent name, e.g. `paqad-development`. Absent on the main thread. */
  agentType?: unknown;
  /** The host's opaque per-dispatch id. Absent on the main thread. */
  agentId?: unknown;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve the agent identity to stamp on a stage-evidence row.
 *
 * Prefers `agent_type` because it is the meaningful, stable name (`paqad-review`) rather
 * than an opaque per-dispatch id. Falls back to `agent_id` so a host that exposes only the
 * id still attributes the row to *something* other than the orchestrator — recording
 * `orchestrator` for a row a subagent actually wrote would be worse than recording an
 * opaque id. With neither field present the main chat wrote it.
 */
export function resolveAgentIdentity(input: AgentIdentityInput = {}): string {
  return nonEmpty(input.agentType) ?? nonEmpty(input.agentId) ?? ORCHESTRATOR_AGENT;
}

/** True when `agent` names a dispatched paqad stage agent rather than the orchestrator. */
export function isStageAgent(agent: string | null | undefined): boolean {
  return typeof agent === 'string' && agent.startsWith('paqad-');
}
