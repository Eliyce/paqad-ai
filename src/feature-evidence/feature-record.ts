// The feature.json writer (issue #511, RC-1).
//
// #339 Phase 1 shipped the `feature.json` schema and `buildFeatureRecord()` as a "dark
// foundation", but nothing ever called the builder — so a live bundle carried its title
// and ticket only in the directory NAME, and an untitled `change-<ULID>` bundle stayed
// nameless forever. This module is the missing writer: it seeds `feature.json` when a
// feature is opened and patches it on rename / lane / spec-freeze / close, re-stamping the
// identity `content_hash` each time. Writes are atomic (temp + rename) and best-effort on
// the hot path — a write failure degrades to no record, never a throw into the recorder.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readUnitFile, type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { buildFeatureRecord, UNTITLED_FEATURE_TITLE } from './mint.js';
import { featureFilePath, parseFeatureDirName } from './paths.js';
import { validateFeatureRecord } from './schema.js';
import type { FeatureLane, FeatureRecord, FeatureStatus, LegacyFeatureRecord } from './types.js';

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

/**
 * A pre-#581 record (schema version 1) read under the current names (INV-8): `ulid` is the
 * `change`, `session_first_seen` the `session_id`, `created_at` the `recorded_at`. The
 * stored `content_hash` is kept, so the next patch sees a changed identity and rewrites the
 * file in the new shape (writers only write the new header, INV-9).
 */
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

/**
 * Tolerant read of a feature's `feature.json`, or null when absent/corrupt/invalid. A record
 * written before #581 reads too, mapped onto the current field names.
 */
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
  } catch {
    // Absent / unreadable / malformed — fall through to null.
  }
  return null;
}

/** Validate + atomically write a feature record. Throws on a schema violation (script-owned). */
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
  /** Lifecycle status to seed with; `active` unless the evidence migration seeds `spec-only`. */
  status?: FeatureStatus;
  /** The git branch at open and its merge base (issue #581); null off a branch. */
  branch?: string | null;
  baseBranch?: string | null;
  now?: () => Date;
}

/**
 * Seed `feature.json` for a freshly-opened feature, idempotently: when the bundle already
 * carries a valid record this is a no-op (returns the existing one), so re-opening an
 * already-open change never re-mints or churns the file. The identity (issue / slug / ulid)
 * is taken from the dir name — never from the model — so it can never drift from the bundle
 * it belongs to. Best-effort: a write failure returns null rather than throwing into the
 * recorder hot path.
 */
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
    // The dir-name slug is the best title known at open; a later `plan compile` patches it to
    // the human title. For an untitled `change-<ULID>` bundle the slug IS the placeholder, so
    // AC-2's "no title and no ticket" case is exactly `title === 'change' && issue === null`.
    title: parts.slug,
    slug: parts.slug,
    change: parts.ulid,
    lane: input.lane ?? null,
    status: input.status ?? 'active',
    session_id: input.sessionId,
    adapter: input.adapter,
    branch: input.branch ?? null,
    base_branch: input.baseBranch ?? null,
    now: input.now,
  });
  try {
    writeFeatureRecord(projectRoot, dirName, record);
    return record;
  } catch {
    // Best-effort: a filesystem write fault must not break the recorder hot path.
    return null;
  }
}

/** The identity + status fields a patch may change; every field is optional. */
export interface FeatureRecordPatch {
  title?: string;
  slug?: string;
  issue?: string | null;
  lane?: FeatureLane;
  status?: FeatureStatus;
  spec_id?: string | null;
  /** Session constants (issue #581): updated in place, the latest host wins. */
  adapter?: string;
  branch?: string | null;
  base_branch?: string | null;
}

/**
 * Patch an existing `feature.json` (title / slug / issue on rename, lane, status:'done' on
 * close, spec_id on freeze), re-stamping the identity `content_hash` and `updated_at`. When
 * nothing actually changes the write is skipped, so a per-stage call never churns the file
 * or the working tree. When the record is absent (a best-effort seed was missed) a minimal
 * one is rebuilt from the dir-name parts so the bundle is never left without feature.json.
 * Best-effort: a write failure returns null rather than throwing.
 */
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
      // The seed was missed, so provenance is unknown; a valid non-empty placeholder keeps
      // the schema satisfied without inventing a session/adapter that never opened it.
      session_id: 'unknown',
      adapter: 'unknown',
      now,
    });

  // Re-stamped through the one envelope builder: `change` and `session_id` (the opener) and
  // `recorded_at` (when the change opened) carry over. `updated_at` is outside the identity
  // hash, so it is only moved (and the clock only read) once the identity has changed.
  const next = buildFeatureRecord({
    change: current.change,
    session_id: current.session_id,
    recorded_at: current.recorded_at,
    issue: patch.issue !== undefined ? patch.issue : current.issue,
    title: patch.title ?? current.title,
    slug: patch.slug ?? current.slug,
    lane: patch.lane !== undefined ? patch.lane : current.lane,
    status: patch.status ?? current.status,
    spec_id: patch.spec_id !== undefined ? patch.spec_id : current.spec_id,
    adapter: patch.adapter ?? current.adapter,
    branch: patch.branch !== undefined ? patch.branch : (current.branch ?? null),
    base_branch:
      patch.base_branch !== undefined ? patch.base_branch : (current.base_branch ?? null),
    now: () => new Date(current.updated_at),
  });
  // No identity change → skip the write so a per-stage patch never churns the file.
  if (next.content_hash === current.content_hash) {
    return current;
  }
  next.updated_at = now().toISOString();
  try {
    writeFeatureRecord(projectRoot, dirName, next);
    return next;
  } catch {
    // Best-effort: a write fault degrades to no update, never a throw into the recorder.
    return null;
  }
}

/**
 * True when a feature record has NEITHER a real title NOR a ticket — the placeholder title
 * `change` with a null issue (issue #511, AC-2). A change that reaches completion in this
 * state has no record of what it was, so the bundle-completeness gate fails it.
 */
export function featureRecordIsUntitled(record: FeatureRecord): boolean {
  return record.title === UNTITLED_FEATURE_TITLE && record.issue === null;
}

/** The per-change session constants (issue #581, FR-6). Each is null when unknown. */
export interface ChangeConstants {
  adapter: string | null;
  branch: string | null;
  base_branch: string | null;
  lane: FeatureLane;
}

/** The placeholder adapter a rebuilt record carries when its seed was missed. */
const UNKNOWN_ADAPTER = 'unknown';

function knownString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value !== UNKNOWN_ADAPTER ? value : null;
}

function knownLane(value: unknown): FeatureLane {
  return value === 'fast' || value === 'graduated' || value === 'full' ? value : null;
}

/**
 * Read a change's session constants (issue #581, FR-6): `feature.json` first, the only
 * place a bundle written since #581 carries them, then the legacy `kind:'open'` stage row,
 * where a bundle written before #581 stamped them. Each field falls back on its own, so a
 * pre-#581 `feature.json` with no `branch` still gets the branch its open row recorded.
 * `rows` lets a caller that already read the stage ledger skip a second read.
 */
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
