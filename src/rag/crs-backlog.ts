import type { CrsChunkInput, CrsCollectionId } from './types.js';
import { EmbeddingBacklogOverflow } from './types.js';

export const DEFAULT_CRS_BACKLOG_CAP = 1000;

interface BacklogEntry {
  collectionId: CrsCollectionId;
  chunk: CrsChunkInput;
}

export type CrsBacklogPersist = (
  collectionId: CrsCollectionId,
  chunks: CrsChunkInput[],
) => Promise<void>;

export class CrsBacklogQueue {
  private readonly entries: BacklogEntry[] = [];

  constructor(private readonly cap: number = DEFAULT_CRS_BACKLOG_CAP) {}

  get size(): number {
    return this.entries.length;
  }

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

  async drain(persist: CrsBacklogPersist): Promise<void> {
    while (this.entries.length > 0) {
      const collectionId = this.entries[0].collectionId;
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
