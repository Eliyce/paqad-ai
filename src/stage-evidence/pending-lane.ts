// Pending-lane stash (issue #324).
//
// The prompt seam decides a deterministic lane for the request BEFORE any change
// is opened. It stashes the lane here; the next `openStageEvidence` reads it and
// stamps it on the change's open ledger row, so the recorded lane is the one the
// classifier picked for THIS prompt (not a null the consumers must guess around).
//
// Session-scoped, one value per session, in the (git-ignored) ledger dir. A prompt
// with no code intent writes nothing (the seam skips a null lane), so a re-read
// only ever returns the last real code-intent lane — read once at open, harmless
// if it lingers. Never throws into the caller: an unreadable/absent stash is null.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sessionLedgerDir } from '@/session-ledger/ledger.js';

import { STAGE_EVIDENCE_DOC_TYPE, type StageLane } from './types.js';

const PENDING_LANE_FILE = '.pending-lane';
const VALID_LANES: readonly string[] = ['fast', 'graduated', 'full'];

function pendingLaneDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId));
}

/** Stash the lane for `sessionId`. A `null` lane (no code intent) is a no-op. */
export function writePendingLane(projectRoot: string, sessionId: string, lane: StageLane): void {
  if (lane === null) {
    return;
  }
  const dir = pendingLaneDir(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PENDING_LANE_FILE), lane, 'utf8');
}

/** Read the stashed lane for `sessionId`, or `null` when absent/invalid. */
export function readPendingLane(projectRoot: string, sessionId: string): StageLane {
  try {
    const raw = readFileSync(
      join(pendingLaneDir(projectRoot, sessionId), PENDING_LANE_FILE),
      'utf8',
    )
      .trim()
      .toLowerCase();
    return VALID_LANES.includes(raw) ? (raw as StageLane) : null;
  } catch {
    return null;
  }
}
