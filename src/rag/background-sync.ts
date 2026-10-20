import { join } from 'node:path';

import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { PATHS } from '@/core/constants/paths.js';
import type { ProviderFactory } from '@/rag/types.js';
import { RagService } from '@/rag/service.js';

const STALE_LOCK_MS = 10 * 60 * 1000;

export type BackgroundSyncResult =
  { synced: true } | { synced: false; reason: 'in-flight' | 'disabled' | 'no-index' | 'error' };

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
