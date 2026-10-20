import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { readUnitFile, type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { higherLane } from './lane-rank.js';
import { buildFeatureRecord, UNTITLED_FEATURE_TITLE } from './mint.js';
import { featureFilePath, parseFeatureDirName } from './paths.js';
import { validateFeatureRecord } from './schema.js';
import type {
  FeatureChangeKind,
  FeatureLane,
  FeatureRecord,
  FeatureStatus,
  LegacyFeatureRecord,
} from './types.js';

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameWithRetrySync(tmp, absPath);
}

function fromLegacyFeatureRecord(legacy: LegacyFeatureRecord): FeatureRecord {
  return {
    schema_version: legacy.schema_version,
    doc_type: legacy.doc_type,
    change: legacy.ulid,
    session_id: legacy.session_first_seen,
    recorded_at: legacy.created_at,
    content_hash: legacy.content_hash,
    issue: legacy.issue,
    title: legacy.title,
    slug: legacy.slug,
    lane: legacy.lane,
    status: legacy.status,
    spec_id: legacy.spec_id,
    adapter: legacy.adapter,
    branch: legacy.branch ?? null,
    base_branch: legacy.base_branch ?? null,
    updated_at: legacy.updated_at,
  };
}

export function readFeatureRecord(projectRoot: string, dirName: string): FeatureRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'feature')), 'utf8'),
    ) as unknown;
    if (validateFeatureRecord(parsed).length === 0) {
      const record = parsed as FeatureRecord | LegacyFeatureRecord;
      return record.schema_version === 1
        ? fromLegacyFeatureRecord(record as LegacyFeatureRecord)
        : (record as FeatureRecord);
    }
  } catch {}
  return null;
}

export function writeFeatureRecord(
  projectRoot: string,
  dirName: string,
  record: FeatureRecord,
): void {
  const errors = validateFeatureRecord(record);
  if (errors.length > 0) {
    throw new Error(`Invalid feature.json: ${errors.join('; ')}`);
  }
  atomicWriteJson(join(projectRoot, featureFilePath(dirName, 'feature')), record);
}

export interface SeedFeatureRecordInput {
  adapter: string;
  sessionId: string;
  lane?: FeatureLane;
  status?: FeatureStatus;
  branch?: string | null;
  baseBranch?: string | null;
  kind?: FeatureChangeKind;
  now?: () => Date;
}

export function seedFeatureRecord(
  projectRoot: string,
  dirName: string,
  input: SeedFeatureRecordInput,
): FeatureRecord | null {
  const existing = readFeatureRecord(projectRoot, dirName);
  if (existing) {
    return existing;
  }
  const parts = parseFeatureDirName(dirName);
  if (!parts) {
    return null;
  }
  const record = buildFeatureRecord({
    issue: parts.issue,
    title: parts.slug,
    slug: parts.slug,
    change: parts.ulid,
    lane: input.lane ?? null,
    status: input.status ?? 'active',
    session_id: input.sessionId,
    adapter: input.adapter,
    branch: input.branch ?? null,
    base_branch: input.baseBranch ?? null,
    kind: input.kind,
    now: input.now,
  });
  try {
    writeFeatureRecord(projectRoot, dirName, record);
    return record;
  } catch {
    return null;
  }
}

export interface FeatureRecordPatch {
  title?: string;
  slug?: string;
  issue?: string | null;
  lane?: FeatureLane;
  status?: FeatureStatus;
  spec_id?: string | null;
  adapter?: string;
  branch?: string | null;
  base_branch?: string | null;
  kind?: FeatureChangeKind;
}

export function higherKind(
  current: FeatureChangeKind | undefined,
  next: FeatureChangeKind,
): FeatureChangeKind {
  return current === 'fix' ? 'fix' : next;
}

export function updateFeatureRecord(
  projectRoot: string,
  dirName: string,
  patch: FeatureRecordPatch,
  now: () => Date = () => new Date(),
): FeatureRecord | null {
  const parts = parseFeatureDirName(dirName);
  if (!parts) {
    return null;
  }
  const current =
    readFeatureRecord(projectRoot, dirName) ??
    buildFeatureRecord({
      issue: parts.issue,
      title: parts.slug,
      slug: parts.slug,
      change: parts.ulid,
      status: 'active',
      session_id: 'unknown',
      adapter: 'unknown',
      now,
    });

  const nextLane = patch.lane !== undefined ? higherLane(current.lane, patch.lane) : current.lane;

  const next = buildFeatureRecord({
    change: current.change,
    session_id: current.session_id,
    recorded_at: current.recorded_at,
    issue: patch.issue !== undefined ? patch.issue : current.issue,
    title: patch.title ?? current.title,
    slug: patch.slug ?? current.slug,
    lane: nextLane,
    status: patch.status ?? current.status,
    spec_id: patch.spec_id !== undefined ? patch.spec_id : current.spec_id,
    adapter: patch.adapter ?? current.adapter,
    branch: patch.branch !== undefined ? patch.branch : (current.branch ?? null),
    base_branch:
      patch.base_branch !== undefined ? patch.base_branch : (current.base_branch ?? null),
    kind: patch.kind !== undefined ? higherKind(current.kind, patch.kind) : current.kind,
    now: () => new Date(current.updated_at),
  });
  if (next.content_hash === current.content_hash) {
    return current;
  }
  next.updated_at = now().toISOString();
  try {
    writeFeatureRecord(projectRoot, dirName, next);
    return next;
  } catch {
    return null;
  }
}

export function featureRecordIsUntitled(record: FeatureRecord): boolean {
  return record.title === UNTITLED_FEATURE_TITLE && record.issue === null;
}

export interface ChangeConstants {
  adapter: string | null;
  branch: string | null;
  base_branch: string | null;
  lane: FeatureLane;
}

const UNKNOWN_ADAPTER = 'unknown';

function knownString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value !== UNKNOWN_ADAPTER ? value : null;
}

function knownLane(value: unknown): FeatureLane {
  return value === 'fast' || value === 'graduated' || value === 'full' ? value : null;
}

export function readChangeConstants(
  projectRoot: string,
  dirName: string,
  rows?: readonly SessionLedgerRow[],
): ChangeConstants {
  const record = readFeatureRecord(projectRoot, dirName);
  const fromRecord: ChangeConstants = {
    adapter: knownString(record?.adapter),
    branch: knownString(record?.branch),
    base_branch: knownString(record?.base_branch),
    lane: knownLane(record?.lane),
  };
  if (
    fromRecord.adapter !== null &&
    fromRecord.branch !== null &&
    fromRecord.base_branch !== null &&
    fromRecord.lane !== null
  ) {
    return fromRecord;
  }
  const openRow = (
    rows ?? readUnitFile(projectRoot, featureFilePath(dirName, 'stageEvidence'))
  ).find((row) => row.kind === 'open');
  return {
    adapter: fromRecord.adapter ?? knownString(openRow?.adapter),
    branch: fromRecord.branch ?? knownString(openRow?.branch),
    base_branch: fromRecord.base_branch ?? knownString(openRow?.base_branch),
    lane: fromRecord.lane ?? knownLane(openRow?.lane),
  };
}
