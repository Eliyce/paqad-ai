export type EphemeralCollectionId = string & { readonly __brand: 'EphemeralCollectionId' };

export function toEphemeralCollectionId(sessionId: string): EphemeralCollectionId {
  return sessionId as EphemeralCollectionId;
}

export type AttachmentRecordStatus = 'indexed' | 'stale' | 'in-progress';

export interface AttachmentRecord {
  sessionId: string;
  collectionId: EphemeralCollectionId;
  filePaths: string[];
  status: AttachmentRecordStatus;
}

export interface AttachmentIndexingResult {
  collectionId: EphemeralCollectionId;
  chunkCount: number;
  durationMs: number;
}

export interface AttachmentIndexingDegradedSignal {
  kind: 'attachment_indexing_degraded';
  sessionId: string;
  reason: string;
  retriesExhausted: boolean;
}

export type AttachmentIndexingOutcome = AttachmentIndexingResult | AttachmentIndexingDegradedSignal;

export function isAttachmentIndexingDegraded(
  outcome: AttachmentIndexingOutcome,
): outcome is AttachmentIndexingDegradedSignal {
  return (outcome as AttachmentIndexingDegradedSignal).kind === 'attachment_indexing_degraded';
}

export interface AttachmentOrphanPurgeRecord {
  collectionId: EphemeralCollectionId;
  purgedAt: string;
}
