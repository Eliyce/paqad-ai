/**
 * Incremental working-tree index sync, driven in the background (RAG buildout F9).
 *
 * The index follows the working tree: on each prompt the F5 refresh trigger
 * spawns a detached `paqad-ai rag refresh-context`, which calls this. It diffs the
 * working tree against the index by content hash (via `RagService.refreshContext`),
 * re-embeds only changed chunks — cache-backed (F8), so a previously-seen branch
 * re-embeds nothing — and atomic-swaps the index with refreshed branch metadata
 * (F7). A branch switch self-heals: the new branch's file changes are absorbed as
 * ordinary diffs.
 *
 * It never blocks the coding path: it runs detached, single-flight-locked so
 * concurrent triggers no-op, and only ever touches an index that already exists
 * (an initial build stays an explicit `rag init` / `rebuild`).
 */
import { join } from 'node:path';

import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { PATHS } from '@/core/constants/paths.js';
import type { ProviderFactory } from '@/rag/types.js';
import { RagService } from '@/rag/service.js';

/** A lock older than this (10 min) is treated as a crashed worker and reclaimed. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export type BackgroundSyncResult =
  { synced: true } | { synced: false; reason: 'in-flight' | 'disabled' | 'no-index' | 'error' };

/**
 * Single-flight incremental sync of the vector index for `projectRoot`. Returns
 * a structured outcome; never throws (a sync failure is best-effort background
 * work). `providerFactory` is injectable for tests.
 */
export async function backgroundIndexSync(
  projectRoot: string,
  providerFactory?: ProviderFactory,
): Promise<BackgroundSyncResult> {
  const lockDir = join(projectRoot, PATHS.LOCKS_DIR, 'rag-sync.lock');
  const lock = tryAcquireLock(lockDir, { staleLockMs: STALE_LOCK_MS });
  if (!lock.acquired) {
    return { synced: false, reason: 'in-flight' };
  }
  try {
    const service = new RagService(projectRoot, providerFactory);
    const status = await service.getStatus();
    if (!status.enabled) {
      return { synced: false, reason: 'disabled' };
    }
    // Only sync an index that already exists; an initial build stays explicit.
    if (!status.index_present || !status.valid) {
      return { synced: false, reason: 'no-index' };
    }
    await service.refreshContext();
    return { synced: true };
  } catch {
    return { synced: false, reason: 'error' };
  } finally {
    releaseLock(lockDir);
  }
}
