import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCollectionId, listCollections, registerCollection } from '@/rag/attachment-registry.js';
import { toEphemeralCollectionId } from '@/rag/attachment-types.js';
import { runOrphanSweep } from '@/rag/orphan-sweep.js';

const ATTACH_DIR = '.paqad/attachments';

describe('runOrphanSweep', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-attach-sweep-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function seedCollection(sessionId: string): void {
    const dir = join(projectRoot, ATTACH_DIR, sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.json'), '{"version":1,"dimensions":0,"items":[]}');
  }

  async function register(sessionId: string): Promise<void> {
    seedCollection(sessionId);
    await registerCollection(projectRoot, sessionId, toEphemeralCollectionId(sessionId));
  }

  it('purges collections whose session is not live and keeps the live ones', async () => {
    await register('live');
    await register('dead-1');
    await register('dead-2');

    const purged = await runOrphanSweep(projectRoot, ['live']);

    expect(purged.map((record) => record.collectionId).sort()).toEqual(['dead-1', 'dead-2']);
    expect(purged.every((record) => typeof record.purgedAt === 'string')).toBe(true);

    expect(existsSync(join(projectRoot, ATTACH_DIR, 'live'))).toBe(true);
    expect(existsSync(join(projectRoot, ATTACH_DIR, 'dead-1'))).toBe(false);
    expect(existsSync(join(projectRoot, ATTACH_DIR, 'dead-2'))).toBe(false);

    // Purged sessions are removed from the registry; the live one remains.
    expect(await getCollectionId(projectRoot, 'live')).toBe('live');
    expect(await getCollectionId(projectRoot, 'dead-1')).toBeNull();

    const audit = readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8');
    expect(audit.match(/rag\.orphan_collection_purged/g)).toHaveLength(2);
  });

  it('purges every collection when no session is live', async () => {
    await register('a');
    await register('b');

    const purged = await runOrphanSweep(projectRoot, []);

    expect(purged).toHaveLength(2);
    expect(await listCollections(projectRoot)).toEqual([]);
  });

  it('returns an empty list when there are no collections', async () => {
    expect(await runOrphanSweep(projectRoot, [])).toEqual([]);
  });

  it('deregisters a traversal session id without deleting anything outside the root', async () => {
    // A sentinel that must survive: it lives outside the attachments root.
    const sentinel = join(projectRoot, 'sentinel.txt');
    writeFileSync(sentinel, 'keep me');

    // Hand-craft a registry row whose id would escape the attachments root.
    mkdirSync(join(projectRoot, ATTACH_DIR), { recursive: true });
    writeFileSync(
      join(projectRoot, ATTACH_DIR, 'registry.json'),
      JSON.stringify({
        version: 1,
        collections: [
          {
            sessionId: '../../sentinel.txt',
            collectionId: '../../sentinel.txt',
            filePaths: [],
            status: 'indexed',
          },
        ],
      }),
    );

    const purged = await runOrphanSweep(projectRoot, []);

    // The unsafe row is dropped but never triggers a filesystem delete.
    expect(purged).toEqual([]);
    expect(existsSync(sentinel)).toBe(true);
    expect(await listCollections(projectRoot)).toEqual([]);
  });
});
