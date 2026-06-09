// PQD-415 — in-memory write backlog for CRS collections.
//
// When the embedding provider is unreachable, chunks bound for a CRS collection
// are parked here instead of being lost. The queue is capped (default 1000); a
// write that would exceed the cap drops the oldest pending chunks and surfaces an
// {@link EmbeddingBacklogOverflow} so the desktop can show a degraded-mode notice.
// When the provider recovers, {@link CrsBacklogQueue.drain} flushes the backlog
// (oldest-first, grouped per collection) through a caller-supplied persist fn.
//
// IMPORTANT: the backlog is in-memory only. A host-process restart silently loses
// any queued chunks — the desktop must treat an overflow as a data-loss signal.

import type { CrsChunkInput, CrsCollectionId } from './types.js';
import { EmbeddingBacklogOverflow } from './types.js';

/** Default maximum number of chunks the backlog holds before dropping the oldest. */
export const DEFAULT_CRS_BACKLOG_CAP = 1000;

interface BacklogEntry {
  collectionId: CrsCollectionId;
  chunk: CrsChunkInput;
}

/** Persist a batch of backlogged chunks for one collection (embed + write). */
export type CrsBacklogPersist = (
  collectionId: CrsCollectionId,
  chunks: CrsChunkInput[],
) => Promise<void>;

export class CrsBacklogQueue {
  private readonly entries: BacklogEntry[] = [];

  constructor(private readonly cap: number = DEFAULT_CRS_BACKLOG_CAP) {}

  /** Number of chunks currently parked across all collections. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Park `chunks` for `collectionId`. If the resulting size exceeds the cap, the
   * oldest entries are dropped to bring it back to the cap and an
   * {@link EmbeddingBacklogOverflow} is thrown carrying the number dropped.
   */
  enqueue(chunks: CrsChunkInput[], collectionId: CrsCollectionId): void {
    for (const chunk of chunks) {
      this.entries.push({ collectionId, chunk });
    }
    let dropped = 0;
    while (this.entries.length > this.cap) {
      this.entries.shift();
      dropped++;
    }
    if (dropped > 0) {
      throw new EmbeddingBacklogOverflow(dropped);
    }
  }

  /**
   * Flush the backlog oldest-first, grouped per collection, through `persist`.
   * A group that persists successfully is removed; if `persist` throws, that
   * group (and the rest) stay queued and the error propagates so the caller can
   * retry on the next recovery.
   */
  async drain(persist: CrsBacklogPersist): Promise<void> {
    while (this.entries.length > 0) {
      const collectionId = this.entries[0].collectionId;
      // Take the contiguous run of the same collection from the front, preserving
      // insertion order within the collection.
      const batch: CrsChunkInput[] = [];
      let count = 0;
      for (const entry of this.entries) {
        if (entry.collectionId !== collectionId) {
          break;
        }
        batch.push(entry.chunk);
        count++;
      }
      await persist(collectionId, batch);
      this.entries.splice(0, count);
    }
  }
}
