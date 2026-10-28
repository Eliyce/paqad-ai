import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { stripPluginAgentNamespace } from '@/stage-isolation/stage-agents.js';

import { isStageAgent } from './agent-identity.js';
import { RECORD_REPAIR_KIND, STAGE_AGENT_KIND } from './types.js';

export interface LiveStageAgent {
  stage: string;
  agent: string | null;
  agentId: string | null;
  startedAt: string;
  sessionId: string;
  hostPid: number | null;
  rowHash: string;
}

export interface StageAgentIdentity {
  agent: string | null;
  agentId: string | null;
}

function rowTime(row: SessionLedgerRow): number {
  return Date.parse(rowRecordedAt(row) ?? '');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export const STAGE_AGENT_SESSION_RELEASE =
  'a new session began, so stage agents left from the last session no longer hold the turn-end judgement';

export function stageAgentIdentity(agent: unknown, agentId: unknown): StageAgentIdentity {
  const name = stringOrNull(agent);
  return {
    agent: name === null ? null : stripPluginAgentNamespace(name),
    agentId: stringOrNull(agentId),
  };
}

function identityOf(row: SessionLedgerRow): StageAgentIdentity {
  return stageAgentIdentity(row.agent, row.agent_id);
}

export function startedByAnotherAgent(
  starter: StageAgentIdentity,
  holder: StageAgentIdentity,
): boolean {
  if (starter.agentId !== null && starter.agentId !== holder.agentId) return true;
  return isStageAgent(starter.agent) && starter.agent !== holder.agent;
}

function releasesStartedAgent(
  later: SessionLedgerRow,
  stage: string,
  holder: StageAgentIdentity,
  startedHash: string,
): boolean {
  const laterStage = stringOrNull(later.stage);
  const laterId = stringOrNull(later.agent_id);
  const agentId = holder.agentId;
  if (later.kind === STAGE_AGENT_KIND && later.event_status === 'started') {
    return laterStage === stage && (agentId === null || laterId !== agentId);
  }
  if (later.kind === STAGE_AGENT_KIND) {
    return agentId !== null && laterId !== null ? laterId === agentId : laterStage === stage;
  }
  if (later.kind === 'stage_end') return laterStage === stage;
  if (later.kind === 'stage_start') {
    return (
      laterStage !== null &&
      laterStage !== stage &&
      laterId === null &&
      !startedByAnotherAgent(identityOf(later), holder)
    );
  }
  if (later.kind !== RECORD_REPAIR_KIND || later.reason !== STAGE_AGENT_SESSION_RELEASE) {
    return false;
  }
  return !Array.isArray(later.releases) || later.releases.includes(startedHash);
}

export function liveStageAgents(rows: readonly SessionLedgerRow[]): LiveStageAgent[] {
  const live: LiveStageAgent[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== STAGE_AGENT_KIND || row.event_status !== 'started') return;
    const stage = stringOrNull(row.stage);
    if (stage === null) return;
    if (Number.isNaN(rowTime(row))) return;
    const holder = identityOf(row);
    const released = rows
      .slice(index + 1)
      .some((later) => releasesStartedAgent(later, stage, holder, row.content_hash));
    if (released) return;
    live.push({
      stage,
      agent: holder.agent,
      agentId: holder.agentId,
      startedAt: rowRecordedAt(row)!,
      sessionId: row.session_id,
      hostPid: typeof row.host_pid === 'number' ? row.host_pid : null,
      rowHash: row.content_hash,
    });
  });
  return live;
}
