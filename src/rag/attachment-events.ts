// PQD-331 — structured attachment-indexing lifecycle events.
//
// A thin, append-only JSONL writer (parallel to `audit.ts`) that records every
// terminal outcome of an attachment-index call. The desktop tails this file (or
// subscribes to the in-process callback the indexer threads through) to badge an
// attachment as indexed, failed, or rejected. Kept disjoint from the RAG audit
// log so attachment concerns never pollute the broader lifecycle stream.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

/** The three terminal outcomes an attachment-index call can record. */
export type AttachmentEventKind =
  | 'attachment.indexed'
  | 'attachment.index_failed'
  | 'attachment.format_rejected';

/** Which collection the attachment was (or would have been) written into. */
export type AttachmentCollectionScope = 'project' | 'session';

/**
 * One recorded attachment-indexing event. `chunk_count` and `provider` are
 * present only on `attachment.indexed`; `reason` is present only on the two
 * failure kinds. `at` is an ISO-8601 timestamp stamped at write time.
 */
export interface AttachmentEvent {
  kind: AttachmentEventKind;
  file_name: string;
  at: string;
  collection_scope?: AttachmentCollectionScope;
  session_id?: string;
  chunk_count?: number;
  provider?: string;
  reason?: string;
}

/** Event payload accepted by {@link appendAttachmentEvent} (timestamp optional). */
export type AttachmentEventInput = Omit<AttachmentEvent, 'at'> & { at?: string };

/** A live sink the indexer can push each event to in addition to the JSONL log. */
export type AttachmentEventSink = (event: AttachmentEvent) => void;

/**
 * Append one attachment event as a JSON line to {@link PATHS.ATTACHMENT_EVENTS_LOG}
 * under `projectRoot`. Stamps `at` when the caller did not supply it and returns
 * the fully-formed record so callers can forward it to a live sink.
 */
export function appendAttachmentEvent(
  projectRoot: string,
  event: AttachmentEventInput,
): AttachmentEvent {
  const record: AttachmentEvent = { ...event, at: event.at ?? new Date().toISOString() };
  const path = join(projectRoot, PATHS.ATTACHMENT_EVENTS_LOG);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/**
 * Read every attachment event recorded for `projectRoot`, oldest first. Returns
 * an empty array when the log does not exist yet; a malformed line is skipped
 * rather than aborting the read so a single bad write never wedges the consumer.
 */
export function readAttachmentEvents(projectRoot: string): AttachmentEvent[] {
  const path = join(projectRoot, PATHS.ATTACHMENT_EVENTS_LOG);
  if (!existsSync(path)) {
    return [];
  }
  const events: AttachmentEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as AttachmentEvent);
    } catch {
      // A corrupt line must not wedge the reader; skip it.
    }
  }
  return events;
}
