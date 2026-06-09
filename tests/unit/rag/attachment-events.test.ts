import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { appendAttachmentEvent, readAttachmentEvents } from '@/rag/attachment-events.js';

describe('attachment events', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-attach-events-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appends an event as a JSON line and stamps a timestamp', () => {
    const record = appendAttachmentEvent(root, {
      kind: 'attachment.indexed',
      file_name: 'report.pdf',
      collection_scope: 'project',
      chunk_count: 4,
      provider: 'local',
    });

    expect(record.at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    const raw = readFileSync(join(root, PATHS.ATTACHMENT_EVENTS_LOG), 'utf8');
    const parsed = JSON.parse(raw.trim());
    expect(parsed).toMatchObject({
      kind: 'attachment.indexed',
      file_name: 'report.pdf',
      chunk_count: 4,
      provider: 'local',
    });
  });

  it('preserves a caller-supplied timestamp', () => {
    const record = appendAttachmentEvent(root, {
      kind: 'attachment.index_failed',
      file_name: 'broken.pdf',
      reason: 'parse-error',
      at: '2020-01-01T00:00:00.000Z',
    });
    expect(record.at).toBe('2020-01-01T00:00:00.000Z');
  });

  it('returns an empty array when no log exists', () => {
    expect(readAttachmentEvents(root)).toEqual([]);
  });

  it('reads back appended events and skips a corrupt line', () => {
    appendAttachmentEvent(root, { kind: 'attachment.indexed', file_name: 'a.txt', chunk_count: 1 });
    // Inject a malformed line between valid records.
    appendFileSync(join(root, PATHS.ATTACHMENT_EVENTS_LOG), 'not json\n', 'utf8');
    appendAttachmentEvent(root, {
      kind: 'attachment.format_rejected',
      file_name: 'b.zip',
      reason: 'zip-bomb',
    });

    const events = readAttachmentEvents(root);
    expect(events.map((event) => event.file_name)).toEqual(['a.txt', 'b.zip']);
  });
});
