import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ORCHESTRATOR_AGENT } from '@/stage-evidence/agent-identity.js';
import { liveStageAgents } from '@/stage-evidence/stage-agent-holds.js';
import { RECORD_REPAIR_KIND } from '@/stage-evidence/types.js';

import { checkStageChain } from './ledger-chain.js';
import { featureFilePath } from './paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from './stage-ledger.js';

export interface ChainRepairResult {
  ok: boolean;
  message: string;
}

export const DEVELOPER_ACTOR = 'developer';

export function repairActor(hasTerminal: boolean | undefined = process.stdin.isTTY): string {
  return hasTerminal ? DEVELOPER_ACTOR : ORCHESTRATOR_AGENT;
}

export function stageAgentRepairRefusal(agentId: string | undefined): string | null {
  return agentId?.trim()
    ? 'a stage agent cannot repair the ledger. Name the break in your report; the orchestrator or the developer runs this command'
    : null;
}

export function repairChainBreak(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  rowNumber: number,
  reason: string,
  actor: string = ORCHESTRATOR_AGENT,
): ChainRepairResult {
  const raw = readFileSync(join(projectRoot, featureFilePath(dirName, 'stageEvidence')), 'utf8');
  const { breaks } = checkStageChain(raw);
  if (!breaks.includes(rowNumber)) {
    return {
      ok: false,
      message:
        breaks.length === 0
          ? `the ledger has no chain break, so row ${rowNumber} needs no repair`
          : `row ${rowNumber} is not a chain break; the breaks are at rows ${breaks.join(', ')}`,
    };
  }
  const row = JSON.parse(raw.split('\n')[rowNumber - 1]!) as { content_hash: string };
  const running = liveStageAgents(readFeatureStageUnit(projectRoot, dirName)).flatMap((live) =>
    live.agent === null ? [] : [live.agent],
  );
  appendFeatureStageRow(projectRoot, sessionId, dirName, {
    kind: RECORD_REPAIR_KIND,
    agent: actor,
    ...(running.length > 0 ? { stage_agents_running: running } : {}),
    reason,
    repairs_row: rowNumber,
    repairs_hash: row.content_hash,
  });
  return { ok: true, message: `recorded a repair for row ${rowNumber}: ${reason}` };
}
