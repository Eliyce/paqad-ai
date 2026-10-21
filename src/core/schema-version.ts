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
import { runSchemaMigrators, type SchemaMigrator } from '@/core/schema-migrators.js';
import type {
  PaqadSchemaMarker,
  SchemaCompatibility,
  SchemaMigrationRecord,
} from '@/core/types/schema-version.js';

const STALE_LOCK_TIMEOUT_MS = 2000;
const LOCK_POLL_MS = 20;

export function schemaMarkerPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SCHEMA_MARKER);
}

export function schemaMigrationLogPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SCHEMA_MIGRATION_LOG);
}

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

export function checkSchemaCompatibility(marker: PaqadSchemaMarker): SchemaCompatibility {
  const comparison = compareSemver(marker.paqad_schema_version, PAQAD_SCHEMA_VERSION);
  if (comparison === 0) return 'compatible';
  if (comparison < 0) return 'needs-migration';
  return 'future';
}

export async function appendMigrationRecord(
  projectRoot: string,
  record: SchemaMigrationRecord,
): Promise<void> {
  const target = schemaMigrationLogPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, JSON.stringify(record) + '\n', 'utf8');
}

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
  /* v8 ignore start -- stale-lock steal only reachable after 2s of contention */
  writeFileSync(lockPath, String(process.pid));
}
/* v8 ignore stop */

async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {}
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkAndMigrateSchema(
  projectRoot: string,
  engineVersion: string,
  options: { migrators?: readonly SchemaMigrator[] } = {},
): Promise<PaqadSchemaMarker> {
  const markerFile = schemaMarkerPath(projectRoot);

  if (!existsSync(markerFile)) {
    return writeSchemaMarker(projectRoot, engineVersion);
  }

  const marker = await readSchemaMarker(projectRoot);

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

  return withSchemaMigrationLock(projectRoot, async () => {
    const current = await readSchemaMarker(projectRoot);
    if (current !== null && checkSchemaCompatibility(current) !== 'needs-migration') {
      return current;
    }
    const fromVersion = current?.paqad_schema_version ?? marker.paqad_schema_version;
    const notes = await runSchemaMigrators(
      {
        projectRoot,
        fromVersion,
        toVersion: PAQAD_SCHEMA_VERSION,
        engineVersion,
      },
      options.migrators,
    );
    const written = await writeSchemaMarker(projectRoot, engineVersion);
    await appendMigrationRecord(projectRoot, {
      from_version: fromVersion,
      to_version: PAQAD_SCHEMA_VERSION,
      migrated_at: new Date().toISOString(),
      engine_version: engineVersion,
      file: PATHS.SCHEMA_MARKER,
      ...(notes.length > 0 ? { notes } : {}),
    });
    return written;
  });
}

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
