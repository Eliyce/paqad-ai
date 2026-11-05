import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RECORD_REPAIR_KIND } from '@/stage-evidence/types.js';

import { checkStageChain } from './ledger-chain.js';
import { featureFilePath } from './paths.js';
import { appendFeatureStageRow } from './stage-ledger.js';

export interface ChainRepairResult {
  ok: boolean;
  message: string;
}

export function repairChainBreak(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  rowNumber: number,
  reason: string,
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
  appendFeatureStageRow(projectRoot, sessionId, dirName, {
    kind: RECORD_REPAIR_KIND,
    reason,
    repairs_row: rowNumber,
    repairs_hash: row.content_hash,
  });
  return { ok: true, message: `recorded a repair for row ${rowNumber}: ${reason}` };
}
