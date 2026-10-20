import { rm } from 'node:fs/promises';

import {
  AttachmentPathError,
  deregisterCollection,
  listCollections,
  resolveCollectionDir,
} from './attachment-registry.js';
import type { AttachmentOrphanPurgeRecord } from './attachment-types.js';
import { appendRagAudit } from './audit.js';

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
