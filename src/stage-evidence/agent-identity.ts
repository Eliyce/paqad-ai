import { stageForAgentName } from '@/stage-isolation/stage-agents.js';

export const ORCHESTRATOR_AGENT = 'orchestrator';

export const BACKSTOP_WRITER = 'backstop';

export function agentForWriter(adapter: string | undefined): string | undefined {
  return adapter === BACKSTOP_WRITER ? BACKSTOP_WRITER : undefined;
}

export interface AgentIdentityInput {
  agentType?: unknown;
  agentId?: unknown;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveAgentIdentity(input: AgentIdentityInput = {}): string {
  return nonEmpty(input.agentType) ?? nonEmpty(input.agentId) ?? ORCHESTRATOR_AGENT;
}

export function isStageAgent(agent: string | null | undefined): boolean {
  return (
    typeof agent === 'string' && agent.startsWith('paqad-') && stageForAgentName(agent) !== null
  );
}
