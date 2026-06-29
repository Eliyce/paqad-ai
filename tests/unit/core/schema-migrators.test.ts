import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths';
import { PAQAD_SCHEMA_VERSION } from '@/core/constants/schema';
import {
  checkAndMigrateSchema,
  schemaMarkerPath,
  schemaMigrationLogPath,
} from '@/core/schema-version';
import { runSchemaMigrators, SCHEMA_MIGRATORS, type SchemaMigrator } from '@/core/schema-migrators';

const ENGINE_VERSION = '9.9.9';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-migrators-'));
}

function writeMarker(projectRoot: string, version: string): void {
  mkdirSync(join(projectRoot, PATHS.AGENCY_DIR), { recursive: true });
  writeFileSync(
    schemaMarkerPath(projectRoot),
    JSON.stringify({
      paqad_schema_version: version,
      written_at: '2025-01-01T00:00:00.000Z',
      written_by_engine_version: '1.0.0',
    }),
    'utf8',
  );
}

function readLog(projectRoot: string): Record<string, unknown>[] {
  const path = schemaMigrationLogPath(projectRoot);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('runSchemaMigrators', () => {
  it('ships an empty production registry at the baseline (no speculative migrators)', () => {
    expect(SCHEMA_MIGRATORS).toEqual([]);
  });

  it('runs only applicable migrators, in registration order, collecting notes', async () => {
    const calls: string[] = [];
    const migrators: SchemaMigrator[] = [
      {
        id: 'alpha',
        appliesTo: () => true,
        migrate: async () => {
          calls.push('alpha');
          return 'did alpha';
        },
      },
      {
        id: 'skipme',
        appliesTo: () => false,
        migrate: async () => {
          calls.push('skipme');
        },
      },
      {
        id: 'beta',
        appliesTo: () => true,
        migrate: async () => {
          calls.push('beta');
        },
      },
    ];

    const notes = await runSchemaMigrators(
      {
        projectRoot: '/x',
        fromVersion: '0.9.0',
        toVersion: '1.0.0',
        engineVersion: ENGINE_VERSION,
      },
      migrators,
    );

    expect(calls).toEqual(['alpha', 'beta']);
    // A migrator with a note is recorded "id: note"; one without is recorded by id alone.
    expect(notes).toEqual(['alpha: did alpha', 'beta']);
  });

  it('passes the version transition through to appliesTo', async () => {
    const seen: Array<[string, string]> = [];
    await runSchemaMigrators(
      {
        projectRoot: '/x',
        fromVersion: '0.9.0',
        toVersion: '1.0.0',
        engineVersion: ENGINE_VERSION,
      },
      [
        {
          id: 'probe',
          appliesTo: (from, to) => {
            seen.push([from, to]);
            return false;
          },
          migrate: async () => {},
        },
      ],
    );
    expect(seen).toEqual([['0.9.0', '1.0.0']]);
  });
});

describe('checkAndMigrateSchema migrator dispatch', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProject();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('runs injected migrators on a needs-migration project and records their notes', async () => {
    writeMarker(projectRoot, '0.9.0');
    const migrator: SchemaMigrator = {
      id: 'stage-evidence',
      appliesTo: () => true,
      migrate: async (ctx) => {
        writeFileSync(join(ctx.projectRoot, 'migrated.sentinel'), ctx.fromVersion);
        return 'rewrote 3 rows';
      },
    };

    const result = await checkAndMigrateSchema(projectRoot, ENGINE_VERSION, {
      migrators: [migrator],
    });

    expect(result.paqad_schema_version).toBe(PAQAD_SCHEMA_VERSION);
    expect(readFileSync(join(projectRoot, 'migrated.sentinel'), 'utf8')).toBe('0.9.0');
    const log = readLog(projectRoot);
    expect(log).toHaveLength(1);
    expect(log[0].notes).toEqual(['stage-evidence: rewrote 3 rows']);
  });

  it('does NOT run migrators on an already-compatible project', async () => {
    writeMarker(projectRoot, PAQAD_SCHEMA_VERSION);
    const migrate = vi.fn(async () => {});
    await checkAndMigrateSchema(projectRoot, ENGINE_VERSION, {
      migrators: [{ id: 'never', appliesTo: () => true, migrate }],
    });
    expect(migrate).not.toHaveBeenCalled();
  });

  it('does NOT run migrators on a future-schema project (refuses instead)', async () => {
    writeMarker(projectRoot, '2.0.0');
    const migrate = vi.fn(async () => {});
    await expect(
      checkAndMigrateSchema(projectRoot, ENGINE_VERSION, {
        migrators: [{ id: 'never', appliesTo: () => true, migrate }],
      }),
    ).rejects.toThrow();
    expect(migrate).not.toHaveBeenCalled();
  });

  it('seals nothing when a migrator throws (marker stays old for retry)', async () => {
    writeMarker(projectRoot, '0.9.0');
    const boom: SchemaMigrator = {
      id: 'boom',
      appliesTo: () => true,
      migrate: async () => {
        throw new Error('migration failed');
      },
    };

    await expect(
      checkAndMigrateSchema(projectRoot, ENGINE_VERSION, { migrators: [boom] }),
    ).rejects.toThrow('migration failed');

    // Marker NOT advanced; no migration record sealed — the next run retries.
    const marker = JSON.parse(readFileSync(schemaMarkerPath(projectRoot), 'utf8'));
    expect(marker.paqad_schema_version).toBe('0.9.0');
    expect(readLog(projectRoot)).toHaveLength(0);
  });

  it('records no notes field when no migrator applies (baseline behaviour preserved)', async () => {
    writeMarker(projectRoot, '0.9.0');
    await checkAndMigrateSchema(projectRoot, ENGINE_VERSION, {
      migrators: [{ id: 'irrelevant', appliesTo: () => false, migrate: async () => {} }],
    });
    const log = readLog(projectRoot);
    expect(log).toHaveLength(1);
    expect(log[0]).not.toHaveProperty('notes');
  });
});
