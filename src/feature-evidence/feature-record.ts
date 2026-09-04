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

import { buildFeatureRecord, computeContentHash, UNTITLED_FEATURE_TITLE } from './mint.js';
import { featureFilePath, parseFeatureDirName } from './paths.js';
import { validateFeatureRecord } from './schema.js';
import type { FeatureLane, FeatureRecord, FeatureStatus } from './types.js';

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

/** Tolerant read of a feature's `feature.json`, or null when absent/corrupt/invalid. */
export function readFeatureRecord(projectRoot: string, dirName: string): FeatureRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'feature')), 'utf8'),
    ) as unknown;
    if (validateFeatureRecord(parsed).length === 0) {
      return parsed as FeatureRecord;
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
    ulid: parts.ulid,
    lane: input.lane ?? null,
    status: 'active',
    session_first_seen: input.sessionId,
    adapter: input.adapter,
    now: input.now,
  });
  try {
    writeFeatureRecord(projectRoot, dirName, record);
    return record;
    /* v8 ignore next 3 -- best-effort: a filesystem write fault must not break the recorder;
       not reproduced in tests. */
  } catch {
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
      ulid: parts.ulid,
      status: 'active',
      // The seed was missed, so provenance is unknown; a valid non-empty placeholder keeps
      // the schema satisfied without inventing a session/adapter that never opened it.
      session_first_seen: 'unknown',
      adapter: 'unknown',
      now,
    });

  const base = {
    schema_version: current.schema_version,
    doc_type: current.doc_type,
    issue: patch.issue !== undefined ? patch.issue : current.issue,
    title: patch.title ?? current.title,
    slug: patch.slug ?? current.slug,
    ulid: current.ulid,
    lane: patch.lane !== undefined ? patch.lane : current.lane,
    status: patch.status ?? current.status,
    spec_id: patch.spec_id !== undefined ? patch.spec_id : current.spec_id,
    session_first_seen: current.session_first_seen,
    adapter: current.adapter,
  } satisfies Omit<FeatureRecord, 'created_at' | 'updated_at' | 'content_hash'>;

  const contentHash = computeContentHash(base);
  // No identity change → skip the write so a per-stage patch never churns the file.
  if (contentHash === current.content_hash) {
    return current;
  }
  const next: FeatureRecord = {
    ...base,
    created_at: current.created_at,
    updated_at: now().toISOString(),
    content_hash: contentHash,
  };
  try {
    writeFeatureRecord(projectRoot, dirName, next);
    return next;
    /* v8 ignore next 3 -- best-effort: a write fault degrades to no update, never a throw. */
  } catch {
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
