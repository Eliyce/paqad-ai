import { readChangeConstants, readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { stageLedgerEra } from '@/stage-evidence/ledger-era.js';
import { RECORD_REPAIR_KIND, STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

import { MANDATORY_STAGE_AGENTS, STAGE_AGENT_STAGES } from './stage-agents.js';

export const CODEX_RECIPE_LINE =
  'recipe read, not injected. On Codex an unfinished stage is caught by the next stage refusing to start and by `paqad-ai stage report`, not sent back.';

function chainRepairLines(rows: readonly SessionLedgerRow[]): string[] {
  return rows
    .filter((row) => row.kind === RECORD_REPAIR_KIND && typeof row.repairs_row === 'number')
    .map((row) => {
      const running = Array.isArray(row.stage_agents_running)
        ? ` while ${row.stage_agents_running.join(', ')} was running`
        : '';
      return `Ledger row ${String(row.repairs_row)} broke the chain and was repaired by ${String(row.agent)}${running}: ${String(row.reason)}.`;
    });
}

export function stageReceiptNotes(projectRoot: string, dirName: string): string[] {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const repairs = chainRepairLines(rows);
  if (readChangeConstants(projectRoot, dirName, rows).lane !== 'full') return repairs;
  const notes: string[] = [...repairs];
  if (readFeatureRecord(projectRoot, dirName)?.adapter === 'codex-cli') {
    notes.push(CODEX_RECIPE_LINE);
  }
  const older = STAGE_AGENT_STAGES.filter(
    (stage) =>
      rows.some((row) => row.kind === 'stage_start' && row.stage === stage) &&
      stageLedgerEra(rows, stage) !== 'v3',
  );
  if (older.length > 0) {
    notes.push(`These stages ran before the update and hold no recipe proof: ${older.join(', ')}.`);
  }
  const turns = stageTurnsLine(rows);
  if (turns !== null) notes.push(turns);
  return notes;
}

export const STAGE_BASELINE_TURNS: Readonly<Record<string, number>> = {
  planning: 64,
  specification: 35,
  development: 109,
  review: 44,
  checks: 10,
  documentation_sync: 17,
};

export function stageTurnsLine(rows: readonly SessionLedgerRow[]): string | null {
  const parts: string[] = [];
  for (const def of MANDATORY_STAGE_AGENTS) {
    const turns = rows
      .filter(
        (row) =>
          row.kind === STAGE_AGENT_KIND &&
          row.event_status === 'completed' &&
          row.stage === def.ledgerStage,
      )
      .reduce((sum, row) => sum + (typeof row.api_turns === 'number' ? row.api_turns : 0), 0);
    if (turns === 0) continue;
    const baseline = STAGE_BASELINE_TURNS[def.ledgerStage];
    parts.push(`${def.ledgerStage} ${turns} of ${def.maxTurns} (was ${baseline})`);
  }
  return parts.length === 0 ? null : `Turns per stage: ${parts.join(', ')}.`;
}
