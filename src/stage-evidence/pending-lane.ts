import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  API_IMPACTS,
  DATABASE_IMPACTS,
  type ApiImpact,
  type DatabaseImpact,
} from '@/core/types/classification.js';
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
    rmSync(join(pendingLaneDir(projectRoot, sessionId), PENDING_IMPACT_FILE), { force: true });
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

const PENDING_IMPACT_FILE = '.pending-impact';

export interface PendingImpact {
  database_impact: DatabaseImpact;
  api_impact: ApiImpact;
}

export function writePendingImpact(
  projectRoot: string,
  sessionId: string,
  impact: PendingImpact,
): void {
  const dir = pendingLaneDir(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, PENDING_IMPACT_FILE),
    JSON.stringify({ database_impact: impact.database_impact, api_impact: impact.api_impact }),
    'utf8',
  );
}

export function readPendingImpact(projectRoot: string, sessionId: string): PendingImpact | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(pendingLaneDir(projectRoot, sessionId), PENDING_IMPACT_FILE), 'utf8'),
    ) as Partial<Record<keyof PendingImpact, unknown>>;
    const database = DATABASE_IMPACTS.find((value) => value === raw.database_impact);
    const api = API_IMPACTS.find((value) => value === raw.api_impact);
    return database !== undefined && api !== undefined
      ? { database_impact: database, api_impact: api }
      : null;
  } catch {
    return null;
  }
}
