import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { safeSessionId, writeFileAtomic } from '@/hud/files.js';
import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

export interface PendingPreMutation {
  session_id: string;
  change: string | null;
  written_at: string;
  files: number;
}

const WITNESS_FILE = '.pending-pre-mutation.json';

export function pendingPreMutationPaths(projectRoot: string, sessionId: string): string[] {
  const safe = safeSessionId(sessionId);
  return [
    join(projectRoot, PATHS.RULE_SCRIPTS_PENDING_DIR, `${safe}.json`),
    join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, safe), WITNESS_FILE),
  ];
}

export function writePendingPreMutation(projectRoot: string, marker: PendingPreMutation): void {
  const body = `${JSON.stringify(marker, null, 2)}\n`;
  for (const path of pendingPreMutationPaths(projectRoot, marker.session_id)) {
    writeFileAtomic(path, body);
  }
}

export function hasPendingPreMutation(projectRoot: string, sessionId: string): boolean {
  return pendingPreMutationPaths(projectRoot, sessionId).some((path) => existsSync(path));
}

export function clearPendingPreMutation(projectRoot: string, sessionId: string): void {
  for (const path of pendingPreMutationPaths(projectRoot, sessionId)) {
    rmSync(path, { force: true });
  }
}
