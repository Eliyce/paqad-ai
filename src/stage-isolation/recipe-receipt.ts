import { readChangeConstants, readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { stageLedgerEra } from '@/stage-evidence/ledger-era.js';

import { STAGE_AGENT_STAGES } from './stage-agents.js';

export const CODEX_RECIPE_LINE =
  'recipe read, not injected. On Codex an unfinished stage is caught by the next stage refusing to start and by `paqad-ai stage report`, not sent back.';

export function stageReceiptNotes(projectRoot: string, dirName: string): string[] {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  if (readChangeConstants(projectRoot, dirName, rows).lane !== 'full') return [];
  const notes: string[] = [];
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
  return notes;
}
