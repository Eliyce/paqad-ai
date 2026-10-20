export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  stopped?: boolean;
  discardedAt?: string | null;
  branchId?: string | null;
  parentMessageId?: string | null;
}

export interface ApiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

export interface RetrievedChunkRef {
  chunkId: string;
  position: number;
}

export interface ConversationRebuildResult {
  messages: ApiMessage[];
  retrievedChunkIds: string[];
  truncated: boolean;
  truncatedTurnCount: number;
  contextHash: string;
}

export type RebuildCacheKey = string;

export class RebuildFailedError extends Error {
  readonly kind = 'rebuild_failed' as const;
  readonly reason: string;

  constructor(reason: string) {
    super(`Conversation rebuild failed: ${reason}`);
    this.name = 'RebuildFailedError';
    this.reason = reason;
  }
}
