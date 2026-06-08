// PQD-174 — boot-time orphan sweep for ephemeral attachment collections.
//
// The desktop calls this on launch with the ids of the sessions that still
// exist. Any registered collection whose owning session is gone is purged from
// disk and the registry, and a `rag.orphan_collection_purged` audit event is
// emitted per purge so the desktop can surface it in a diagnostics view.

import { rm } from 'node:fs/promises';

import {
  AttachmentPathError,
  deregisterCollection,
  listCollections,
  resolveCollectionDir,
} from './attachment-registry.js';
import type { AttachmentOrphanPurgeRecord } from './attachment-types.js';
import { appendRagAudit } from './audit.js';

/**
 * Purge every registered collection whose session id is absent from
 * `liveSessionIds`. Returns one record per purged collection. A collection whose
 * id would escape the attachments root is deregistered but never `rm`-ed, so a
 * crafted session id cannot turn the sweep into an arbitrary-path delete.
 */
export async function runOrphanSweep(
  projectRoot: string,
  liveSessionIds: string[],
): Promise<AttachmentOrphanPurgeRecord[]> {
  const live = new Set(liveSessionIds);
  const collections = await listCollections(projectRoot);
  const purgedAt = new Date().toISOString();
  const purged: AttachmentOrphanPurgeRecord[] = [];

  for (const { sessionId, collectionId } of collections) {
    if (live.has(sessionId)) {
      continue;
    }

    let dir: string | undefined;
    try {
      dir = resolveCollectionDir(projectRoot, sessionId);
    } catch (error) {
      if (!(error instanceof AttachmentPathError)) {
        throw error;
      }
      // Drop the unsafe row from the registry without touching the filesystem.
      await deregisterCollection(projectRoot, sessionId);
      continue;
    }

    await rm(dir, { recursive: true, force: true });
    await deregisterCollection(projectRoot, sessionId);
    appendRagAudit(projectRoot, 'INFO', 'rag.orphan_collection_purged', {
      collection_id: collectionId,
    });
    purged.push({ collectionId, purgedAt });
  }

  return purged;
}
