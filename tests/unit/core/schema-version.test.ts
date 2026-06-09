import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths';
import { PAQAD_SCHEMA_VERSION } from '@/core/constants/schema';
import { SchemaVersionError } from '@/core/errors/schema-version-error';
import {
  appendMigrationRecord,
  checkAndMigrateSchema,
  checkSchemaCompatibility,
  ensureSchemaMarkerSync,
  readSchemaMarker,
  readSchemaMarkerSync,
  schemaMarkerPath,
  schemaMigrationLogPath,
  withSchemaMigrationLock,
  writeSchemaMarker,
  writeSchemaMarkerSync,
} from '@/core/schema-version';
import type { PaqadSchemaMarker } from '@/core/types/schema-version';

const ENGINE_VERSION = '9.9.9';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-schema-'));
}

function writeRawMarker(projectRoot: string, content: string): void {
  const target = schemaMarkerPath(projectRoot);
  mkdirSync(join(projectRoot, PATHS.AGENCY_DIR), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function readLog(projectRoot: string): Record<string, unknown>[] {
  const path = schemaMigrationLogPath(projectRoot);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('schema-version marker I/O', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('round-trips a written marker (async)', async () => {
    const written = await writeSchemaMarker(projectRoot, ENGINE_VERSION);
    expect(written.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    expect(written.written_by_engine_version).toBe(ENGINE_VERSION);

    const read = await readSchemaMarker(projectRoot);
    expect(read).toEqual(written);
  });

  it('round-trips a written marker (sync)', async () => {
    const written = writeSchemaMarkerSync(projectRoot, ENGINE_VERSION);
    expect(written.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);

    const read = await readSchemaMarker(projectRoot);
    expect(read).toEqual(written);
  });

  it('returns null for an absent marker', async () => {
    expect(await readSchemaMarker(projectRoot)).toBeNull();
  });

  it('returns null for a corrupt (unparseable) marker', async () => {
    writeRawMarker(projectRoot, 'not json at all');
    expect(await readSchemaMarker(projectRoot)).toBeNull();
  });

  it('returns null for a structurally invalid marker', async () => {
    writeRawMarker(projectRoot, JSON.stringify({ paqad_schema_version: 'not-semver' }));
    expect(await readSchemaMarker(projectRoot)).toBeNull();
  });

  it('readSchemaMarkerSync mirrors the async reader', () => {
    expect(readSchemaMarkerSync(projectRoot)).toBeNull();
    writeSchemaMarkerSync(projectRoot, ENGINE_VERSION);
    expect(readSchemaMarkerSync(projectRoot)?.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
  });

  it('readSchemaMarkerSync returns null for a corrupt marker', () => {
    writeRawMarker(projectRoot, 'definitely not json');
    expect(readSchemaMarkerSync(projectRoot)).toBeNull();
  });
});

describe('ensureSchemaMarkerSync', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes a marker when none exists', () => {
    const marker = ensureSchemaMarkerSync(projectRoot, ENGINE_VERSION);
    expect(marker.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    expect(existsSync(schemaMarkerPath(projectRoot))).toBe(true);
  });

  it('leaves an existing marker untouched (idempotent timestamp)', () => {
    const first = ensureSchemaMarkerSync(projectRoot, ENGINE_VERSION);
    const second = ensureSchemaMarkerSync(projectRoot, 'different-version');
    expect(second).toEqual(first);
    expect(second.written_by_engine_version).toBe(ENGINE_VERSION);
  });
});

describe('checkSchemaCompatibility', () => {
  const marker = (version: string): PaqadSchemaMarker => ({
    paqad_schema_version: version,
    written_at: '2026-01-01T00:00:00.000Z',
    written_by_engine_version: ENGINE_VERSION,
  });

  it('classifies an equal version as compatible', () => {
    expect(checkSchemaCompatibility(marker(PAQAD_SCHEMA_VERSION))).toBe('compatible');
  });

  it('classifies an older version as needs-migration', () => {
    expect(checkSchemaCompatibility(marker('0.9.0'))).toBe('needs-migration');
  });

  it('classifies a newer version as future', () => {
    expect(checkSchemaCompatibility(marker('2.0.0'))).toBe('future');
    expect(checkSchemaCompatibility(marker('1.0.1'))).toBe('future');
    expect(checkSchemaCompatibility(marker('1.1.0'))).toBe('future');
  });
});

describe('checkAndMigrateSchema', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('stamps a legacy project (no marker) without a migration record', async () => {
    const marker = await checkAndMigrateSchema(projectRoot, ENGINE_VERSION);
    expect(marker.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    expect(existsSync(schemaMarkerPath(projectRoot))).toBe(true);
    expect(readLog(projectRoot)).toHaveLength(0);
  });

  it('is a no-op on an already-compatible project', async () => {
    await writeSchemaMarker(projectRoot, ENGINE_VERSION);
    const result = await checkAndMigrateSchema(projectRoot, ENGINE_VERSION);
    expect(result.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    expect(readLog(projectRoot)).toHaveLength(0);
  });

  it('migrates an older marker forward and appends exactly one record', async () => {
    writeRawMarker(
      projectRoot,
      JSON.stringify({
        paqad_schema_version: '0.9.0',
        written_at: '2025-01-01T00:00:00.000Z',
        written_by_engine_version: '1.0.0',
      }),
    );

    const result = await checkAndMigrateSchema(projectRoot, ENGINE_VERSION);
    expect(result.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);

    const log = readLog(projectRoot);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      from_version: '0.9.0',
      to_version: PAQAD_SCHEMA_VERSION,
      engine_version: ENGINE_VERSION,
      file: PATHS.SCHEMA_MARKER,
    });
    expect(typeof log[0].migrated_at).toBe('string');
  });

  it('refuses a future schema with a SchemaVersionError naming both versions', async () => {
    writeRawMarker(
      projectRoot,
      JSON.stringify({
        paqad_schema_version: '2.0.0',
        written_at: '2027-01-01T00:00:00.000Z',
        written_by_engine_version: '2.0.0',
      }),
    );
    const before = readFileSync(schemaMarkerPath(projectRoot), 'utf8');

    await expect(checkAndMigrateSchema(projectRoot, ENGINE_VERSION)).rejects.toBeInstanceOf(
      SchemaVersionError,
    );
    await expect(checkAndMigrateSchema(projectRoot, ENGINE_VERSION)).rejects.toThrow(/2\.0\.0/);
    await expect(checkAndMigrateSchema(projectRoot, ENGINE_VERSION)).rejects.toThrow(
      new RegExp(PAQAD_SCHEMA_VERSION.replace(/\./g, '\\.')),
    );

    // No file mutated.
    expect(readFileSync(schemaMarkerPath(projectRoot), 'utf8')).toBe(before);
    expect(readLog(projectRoot)).toHaveLength(0);
  });

  it('exposes found and known versions in the error details', async () => {
    writeRawMarker(
      projectRoot,
      JSON.stringify({
        paqad_schema_version: '3.1.4',
        written_at: '2027-01-01T00:00:00.000Z',
        written_by_engine_version: '3.1.4',
      }),
    );

    await expect(checkAndMigrateSchema(projectRoot, ENGINE_VERSION)).rejects.toMatchObject({
      code: 'SCHEMA_VERSION_FUTURE',
      details: { found_version: '3.1.4', known_version: PAQAD_SCHEMA_VERSION },
    });
  });

  it('overwrites a corrupt marker and records from_version: null', async () => {
    writeRawMarker(projectRoot, '{ this is not valid json');

    const result = await checkAndMigrateSchema(projectRoot, ENGINE_VERSION);
    expect(result.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);

    const log = readLog(projectRoot);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ from_version: null, to_version: PAQAD_SCHEMA_VERSION });
  });

  it('converges to one migration record under concurrent calls', async () => {
    writeRawMarker(
      projectRoot,
      JSON.stringify({
        paqad_schema_version: '0.9.0',
        written_at: '2025-01-01T00:00:00.000Z',
        written_by_engine_version: '1.0.0',
      }),
    );

    const results = await Promise.all([
      checkAndMigrateSchema(projectRoot, ENGINE_VERSION),
      checkAndMigrateSchema(projectRoot, ENGINE_VERSION),
      checkAndMigrateSchema(projectRoot, ENGINE_VERSION),
    ]);

    for (const result of results) {
      expect(result.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    }
    expect(readLog(projectRoot)).toHaveLength(1);
    const final = await readSchemaMarker(projectRoot);
    expect(final?.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
  });
});

describe('withSchemaMigrationLock', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('serialises concurrent critical sections', async () => {
    const order: string[] = [];
    const run = (label: string) =>
      withSchemaMigrationLock(projectRoot, async () => {
        order.push(`${label}:enter`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`${label}:exit`);
      });

    await Promise.all([run('a'), run('b')]);

    // Whichever ran first must fully exit before the other enters.
    const firstEnter = order[0];
    const owner = firstEnter.split(':')[0];
    expect(order[1]).toBe(`${owner}:exit`);
  });

  it('releases the lock even when the critical section throws', async () => {
    await expect(
      withSchemaMigrationLock(projectRoot, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Lock is free again — a subsequent acquisition succeeds.
    await expect(withSchemaMigrationLock(projectRoot, async () => 'ok')).resolves.toBe('ok');
  });
});

describe('appendMigrationRecord', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('appends newline-terminated JSON lines', async () => {
    await appendMigrationRecord(projectRoot, {
      from_version: '0.9.0',
      to_version: '1.0.0',
      migrated_at: '2026-01-01T00:00:00.000Z',
      engine_version: ENGINE_VERSION,
      file: PATHS.SCHEMA_MARKER,
    });
    await appendMigrationRecord(projectRoot, {
      from_version: '1.0.0',
      to_version: '1.1.0',
      migrated_at: '2026-02-01T00:00:00.000Z',
      engine_version: ENGINE_VERSION,
      file: PATHS.SCHEMA_MARKER,
    });

    const log = readLog(projectRoot);
    expect(log).toHaveLength(2);
    expect(log[0].to_version).toBe('1.0.0');
    expect(log[1].to_version).toBe('1.1.0');
  });
});
