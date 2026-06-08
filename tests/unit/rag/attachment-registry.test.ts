import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AttachmentPathError,
  collectionVectorPaths,
  deregisterCollection,
  getCollectionId,
  listCollections,
  registerCollection,
  resolveCollectionDir,
} from '@/rag/attachment-registry.js';
import { toEphemeralCollectionId } from '@/rag/attachment-types.js';

const REGISTRY = '.paqad/attachments/registry.json';

describe('attachment-registry', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-attach-registry-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('registers a collection and reads it back', async () => {
    await registerCollection(projectRoot, 'session-a', toEphemeralCollectionId('session-a'), [
      'a.ts',
    ]);

    expect(await getCollectionId(projectRoot, 'session-a')).toBe('session-a');
    expect(await listCollections(projectRoot)).toEqual([
      { sessionId: 'session-a', collectionId: 'session-a' },
    ]);
  });

  it('returns null and an empty list when nothing is registered', async () => {
    expect(await getCollectionId(projectRoot, 'missing')).toBeNull();
    expect(await listCollections(projectRoot)).toEqual([]);
  });

  it('replaces the row when the same session is registered twice', async () => {
    await registerCollection(projectRoot, 'session-a', toEphemeralCollectionId('session-a'), [
      'a.ts',
    ]);
    await registerCollection(projectRoot, 'session-a', toEphemeralCollectionId('session-a'), [
      'a.ts',
      'b.ts',
    ]);

    const all = await listCollections(projectRoot);
    expect(all).toHaveLength(1);
  });

  it('deregisters a known session and no-ops on an unknown one', async () => {
    await registerCollection(projectRoot, 'session-a', toEphemeralCollectionId('session-a'));
    await deregisterCollection(projectRoot, 'session-a');
    expect(await getCollectionId(projectRoot, 'session-a')).toBeNull();

    // Unknown session leaves the registry untouched and does not throw.
    await deregisterCollection(projectRoot, 'never-existed');
    expect(await listCollections(projectRoot)).toEqual([]);
  });

  it('treats a corrupt registry file as empty', async () => {
    mkdirSync(join(projectRoot, '.paqad/attachments'), { recursive: true });
    writeFileSync(join(projectRoot, REGISTRY), 'not json at all');
    expect(await listCollections(projectRoot)).toEqual([]);
  });

  it('treats a registry file without a collections array as empty', async () => {
    mkdirSync(join(projectRoot, '.paqad/attachments'), { recursive: true });
    writeFileSync(join(projectRoot, REGISTRY), JSON.stringify({ version: 1 }));
    expect(await listCollections(projectRoot)).toEqual([]);
  });

  it('derives session-namespaced vector paths', () => {
    expect(collectionVectorPaths(projectRoot, 'session-a')).toEqual({
      indexPath: '.paqad/attachments/session-a/index.json',
      metaPath: '.paqad/attachments/session-a/meta.json',
    });
  });

  it('resolves a contained collection directory', () => {
    const dir = resolveCollectionDir(projectRoot, 'session-a');
    expect(dir.endsWith(join('.paqad', 'attachments', 'session-a'))).toBe(true);
  });

  it('rejects an empty session id', () => {
    expect(() => resolveCollectionDir(projectRoot, '   ')).toThrow(AttachmentPathError);
  });

  it('rejects a traversal session id', () => {
    expect(() => resolveCollectionDir(projectRoot, '../escape')).toThrow(AttachmentPathError);
    expect(() => collectionVectorPaths(projectRoot, '../escape')).toThrow(AttachmentPathError);
  });

  it('rejects a session id that resolves to the attachments root itself', () => {
    expect(() => resolveCollectionDir(projectRoot, '.')).toThrow(AttachmentPathError);
  });
});
