import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export type AttachmentEventKind =
  'attachment.indexed' | 'attachment.index_failed' | 'attachment.format_rejected';

export type AttachmentCollectionScope = 'project' | 'session';

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

export type AttachmentEventInput = Omit<AttachmentEvent, 'at'> & { at?: string };

export type AttachmentEventSink = (event: AttachmentEvent) => void;

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
    } catch {}
  }
  return events;
}
