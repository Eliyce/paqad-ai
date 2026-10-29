import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { stripPluginAgentNamespace } from '@/stage-isolation/stage-agents.js';

import { isStageAgent } from './agent-identity.js';
import { startedAfterLastEnd } from './fold.js';
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

export const RUNNING_STAGE_RECENT_MS = 30 * 60 * 1000;

function newestRowTimes(rows: readonly SessionLedgerRow[]): Map<string, number> {
  const newest = new Map<string, number>();
  for (const row of rows) {
    const at = rowTime(row);
    if (Number.isNaN(at)) continue;
    if (at > (newest.get(row.session_id) ?? Number.NEGATIVE_INFINITY)) {
      newest.set(row.session_id, at);
    }
  }
  return newest;
}

function openStageStarts(rows: readonly SessionLedgerRow[]): SessionLedgerRow[] {
  const byStage = new Map<string, SessionLedgerRow[]>();
  for (const row of rows) {
    if (row.kind !== 'stage_start' && row.kind !== 'stage_end') continue;
    const stage = stringOrNull(row.stage);
    if (stage === null) continue;
    byStage.set(stage, [...(byStage.get(stage) ?? []), row]);
  }
  const open: SessionLedgerRow[] = [];
  for (const events of byStage.values()) {
    if (!startedAfterLastEnd(events)) continue;
    open.push(events.filter((row) => row.kind === 'stage_start').at(-1)!);
  }
  return open.sort((a, b) => rows.indexOf(a) - rows.indexOf(b));
}

export function runningStageOfOtherSession(
  rows: readonly SessionLedgerRow[],
  askingSessionId: string | null,
  nowMs: number,
): string | null {
  const agent = liveStageAgents(rows).find((live) => live.sessionId !== askingSessionId);
  if (agent) return agent.stage;
  const newest = newestRowTimes(rows);
  const running = openStageStarts(rows).filter((started) => {
    if (started.session_id === askingSessionId) return false;
    const last = newest.get(started.session_id);
    return last !== undefined && nowMs - last < RUNNING_STAGE_RECENT_MS;
  });
  return running.length === 0 ? null : stringOrNull(running.at(-1)!.stage);
}
