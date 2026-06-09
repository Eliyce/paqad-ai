// PQD-95 — the cross-artifact `.paqad/` schema versioning baseline.
//
// This module owns the single authoritative version marker for a project's
// `.paqad/` layout and the rules for moving it forward safely:
//
//   - `writeSchemaMarker` / `readSchemaMarker` — atomic read/write of the marker.
//   - `checkSchemaCompatibility` — compares a marker against the running engine.
//   - `appendMigrationRecord` — appends one JSONL line to the migration log.
//   - `withSchemaMigrationLock` — serialises concurrent migrators on one project.
//   - `checkAndMigrateSchema` — the entry point callers run at the start of any
//     engine run: it stamps legacy projects, migrates older ones forward under a
//     lock, and refuses (throws `SchemaVersionError`) on a future schema.
//
// Writes are atomic (temp-file-then-rename, matching `src/quality-ratchet/
// baseline.ts`). The lock uses exclusive-create (`openSync(..., 'wx')`, matching
// `src/planning/decision-store.ts`). That lock primitive is not reliable on some
// network filesystems (NFS, SMB) — the same caveat already applies to
// `DECISIONS_LOCK`.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { PAQAD_SCHEMA_VERSION } from '@/core/constants/schema.js';
import { SchemaVersionError } from '@/core/errors/schema-version-error.js';
import type {
  PaqadSchemaMarker,
  SchemaCompatibility,
  SchemaMigrationRecord,
} from '@/core/types/schema-version.js';

/** Max time to spin waiting for the migration lock before stealing it. */
const STALE_LOCK_TIMEOUT_MS = 2000;
/** Poll interval while waiting for the lock; yields the event loop. */
const LOCK_POLL_MS = 20;

export function schemaMarkerPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SCHEMA_MARKER);
}

export function schemaMigrationLogPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SCHEMA_MIGRATION_LOG);
}

/** Atomically writes the schema marker, creating `.paqad/` if absent. */
export async function writeSchemaMarker(
  projectRoot: string,
  engineVersion: string,
): Promise<PaqadSchemaMarker> {
  const marker: PaqadSchemaMarker = {
    paqad_schema_version: PAQAD_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    written_by_engine_version: engineVersion,
  };
  const target = schemaMarkerPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(marker, null, 2) + '\n', 'utf8');
  await rename(tmp, target);
  return marker;
}

/**
 * Synchronous sibling of `writeSchemaMarker`, for synchronous callers such as
 * `bootstrapFramework`. Same atomic temp-then-rename semantics.
 */
export function writeSchemaMarkerSync(
  projectRoot: string,
  engineVersion: string,
): PaqadSchemaMarker {
  const marker: PaqadSchemaMarker = {
    paqad_schema_version: PAQAD_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    written_by_engine_version: engineVersion,
  };
  const target = schemaMarkerPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(marker, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return marker;
}

/**
 * Reads and parses the marker. Returns `null` when the marker is absent (a
 * legacy project) or unreadable/corrupt — callers decide how to treat each via
 * the dedicated `checkAndMigrateSchema` flow, which distinguishes the two.
 */
export async function readSchemaMarker(projectRoot: string): Promise<PaqadSchemaMarker | null> {
  const target = schemaMarkerPath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8')) as PaqadSchemaMarker;
    if (!isValidMarker(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Synchronous sibling of `readSchemaMarker`. */
export function readSchemaMarkerSync(projectRoot: string): PaqadSchemaMarker | null {
  const target = schemaMarkerPath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as PaqadSchemaMarker;
    if (!isValidMarker(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Stamps the schema marker only when a valid one is not already present, leaving
 * an existing marker (and its `written_at`) untouched. Used by `bootstrapFramework`
 * so repeated bootstraps/onboards are idempotent — re-stamping the layout that is
 * already current would otherwise churn the timestamp on every run. Reconciling a
 * marker for an *older* or *future* layout is the job of `checkAndMigrateSchema`.
 */
export function ensureSchemaMarkerSync(
  projectRoot: string,
  engineVersion: string,
): PaqadSchemaMarker {
  const existing = readSchemaMarkerSync(projectRoot);
  if (existing) return existing;
  return writeSchemaMarkerSync(projectRoot, engineVersion);
}

function isValidMarker(value: unknown): value is PaqadSchemaMarker {
  if (typeof value !== 'object' || value === null) return false;
  const marker = value as Record<string, unknown>;
  return (
    typeof marker.paqad_schema_version === 'string' &&
    isSemver(marker.paqad_schema_version) &&
    typeof marker.written_at === 'string' &&
    typeof marker.written_by_engine_version === 'string'
  );
}

/**
 * Classifies a marker against the running engine's `PAQAD_SCHEMA_VERSION`:
 * equal → `compatible`, older → `needs-migration`, newer → `future`.
 */
export function checkSchemaCompatibility(marker: PaqadSchemaMarker): SchemaCompatibility {
  const comparison = compareSemver(marker.paqad_schema_version, PAQAD_SCHEMA_VERSION);
  if (comparison === 0) return 'compatible';
  if (comparison < 0) return 'needs-migration';
  return 'future';
}

/** Appends one migration record as a newline-terminated JSON line. */
export async function appendMigrationRecord(
  projectRoot: string,
  record: SchemaMigrationRecord,
): Promise<void> {
  const target = schemaMigrationLogPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * Runs `fn` while holding an exclusive migration lock for `projectRoot`. The
 * spin-wait yields the event loop between attempts so an in-process holder can
 * make progress; after `STALE_LOCK_TIMEOUT_MS` the lock is treated as stale and
 * stolen (consistent with the decision-store pattern).
 */
export async function withSchemaMigrationLock<T>(
  projectRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = join(projectRoot, PATHS.SCHEMA_MIGRATION_LOCK);
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + STALE_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return;
    } catch {
      await delay(LOCK_POLL_MS);
    }
  }
  /* v8 ignore next 2 -- stale-lock steal only reachable after 2s of contention */
  writeFileSync(lockPath, String(process.pid));
}

async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // already released
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The entry point callers run at the start of any engine run. Reads the marker
 * and reconciles it with the running engine:
 *
 *   - absent marker (legacy project) → stamp at the current version, no record.
 *   - corrupt/unparseable marker → overwrite at the current version and append a
 *     record with `from_version: null` (under the lock).
 *   - `future` → throw `SchemaVersionError` naming both versions; nothing mutated.
 *   - `needs-migration` → under the lock, re-check, migrate forward, append a
 *     record, and write the updated marker. The re-check makes concurrent runs
 *     converge to exactly one record.
 *   - `compatible` → no-op.
 *
 * Returns the marker the project is left with (`null` only for the `future`
 * branch, which throws before returning).
 */
export async function checkAndMigrateSchema(
  projectRoot: string,
  engineVersion: string,
): Promise<PaqadSchemaMarker> {
  const markerFile = schemaMarkerPath(projectRoot);

  // Absent marker → legacy project. Stamp it; no migration record.
  if (!existsSync(markerFile)) {
    return writeSchemaMarker(projectRoot, engineVersion);
  }

  const marker = await readSchemaMarker(projectRoot);

  // Present but unparseable/invalid → corrupt. Reset under the lock and record it.
  if (marker === null) {
    return withSchemaMigrationLock(projectRoot, async () => {
      const written = await writeSchemaMarker(projectRoot, engineVersion);
      await appendMigrationRecord(projectRoot, {
        from_version: null,
        to_version: PAQAD_SCHEMA_VERSION,
        migrated_at: new Date().toISOString(),
        engine_version: engineVersion,
        file: PATHS.SCHEMA_MARKER,
      });
      return written;
    });
  }

  const compatibility = checkSchemaCompatibility(marker);

  if (compatibility === 'future') {
    throw new SchemaVersionError(
      `This project's .paqad/ layout was written with schema version ${marker.paqad_schema_version}, ` +
        `which is newer than this engine understands (${PAQAD_SCHEMA_VERSION}). ` +
        `Upgrade paqad-ai to operate on this project.`,
      {
        code: 'SCHEMA_VERSION_FUTURE',
        details: {
          found_version: marker.paqad_schema_version,
          known_version: PAQAD_SCHEMA_VERSION,
        },
      },
    );
  }

  if (compatibility === 'compatible') {
    return marker;
  }

  // needs-migration → serialise; re-check under the lock so only one run migrates.
  return withSchemaMigrationLock(projectRoot, async () => {
    const current = await readSchemaMarker(projectRoot);
    if (current !== null && checkSchemaCompatibility(current) !== 'needs-migration') {
      // Another run migrated while we waited for the lock.
      return current;
    }
    const fromVersion = current?.paqad_schema_version ?? marker.paqad_schema_version;
    // v1.0.0 is the baseline: forward migration is just updating the marker.
    // Future versions add format-specific migration steps here, before the
    // marker is rewritten and the record appended.
    const written = await writeSchemaMarker(projectRoot, engineVersion);
    await appendMigrationRecord(projectRoot, {
      from_version: fromVersion,
      to_version: PAQAD_SCHEMA_VERSION,
      migrated_at: new Date().toISOString(),
      engine_version: engineVersion,
      file: PATHS.SCHEMA_MARKER,
    });
    return written;
  });
}

// ---- semver helpers (major.minor.patch only; pre-release tags ignored) ----

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value.trim());
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] {
  const parts = value.trim().split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
