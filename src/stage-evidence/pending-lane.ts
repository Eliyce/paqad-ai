import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FeatureChangeKind } from '@/feature-evidence/types.js';
import { sessionLedgerDir } from '@/session-ledger/ledger.js';

import { STAGE_EVIDENCE_DOC_TYPE, type StageLane } from './types.js';

const PENDING_LANE_FILE = '.pending-lane';
const VALID_LANES: readonly string[] = ['fast', 'graduated', 'full'];

function pendingLaneDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId));
}

export function writePendingLane(projectRoot: string, sessionId: string, lane: StageLane): void {
  if (lane === null) {
    return;
  }
  const dir = pendingLaneDir(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PENDING_LANE_FILE), lane, 'utf8');
}

export function clearPendingLane(projectRoot: string, sessionId: string): void {
  try {
    rmSync(join(pendingLaneDir(projectRoot, sessionId), PENDING_LANE_FILE), { force: true });
    rmSync(join(pendingLaneDir(projectRoot, sessionId), PENDING_KIND_FILE), { force: true });
  } catch {}
}

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

const PENDING_KIND_FILE = '.pending-kind';

export function writePendingKind(
  projectRoot: string,
  sessionId: string,
  kind: FeatureChangeKind,
): void {
  const dir = pendingLaneDir(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PENDING_KIND_FILE), kind, 'utf8');
}

export function readPendingKind(projectRoot: string, sessionId: string): FeatureChangeKind | null {
  try {
    const raw = readFileSync(
      join(pendingLaneDir(projectRoot, sessionId), PENDING_KIND_FILE),
      'utf8',
    )
      .trim()
      .toLowerCase();
    return raw === 'fix' || raw === 'other' ? raw : null;
  } catch {
    return null;
  }
}
