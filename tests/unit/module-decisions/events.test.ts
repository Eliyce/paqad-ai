import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  appendModuleMapEvent,
  readModuleMapEvents,
  readModuleMapEventsForSlug,
  readModuleMapEventsSince,
} from '@/module-decisions/events.js';

describe('module-decisions/events', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-events-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('append creates the file lazily and writes a JSON line', () => {
    appendModuleMapEvent(root, {
      ts: '2026-05-28T00:00:00.000Z',
      type: 'module.declared',
      slug: 'auth',
    });
    const raw = readFileSync(join(root, PATHS.MODULE_MAP_EVENTS_LOG), 'utf8');
    expect(raw).toBe('{"ts":"2026-05-28T00:00:00.000Z","type":"module.declared","slug":"auth"}\n');
  });

  it('round-trips multiple events', () => {
    appendModuleMapEvent(root, {
      ts: '2026-05-28T00:00:00.000Z',
      type: 'module.declared',
      slug: 'a',
    });
    appendModuleMapEvent(root, {
      ts: '2026-05-28T01:00:00.000Z',
      type: 'module.reconciled',
      slug: 'b',
    });
    const events = readModuleMapEvents(root);
    expect(events).toHaveLength(2);
    expect(events[0]?.slug).toBe('a');
    expect(events[1]?.type).toBe('module.reconciled');
  });

  it('returns [] when no events.jsonl exists', () => {
    expect(existsSync(join(root, PATHS.MODULE_MAP_EVENTS_LOG))).toBe(false);
    expect(readModuleMapEvents(root)).toEqual([]);
  });

  it('skips malformed lines without throwing', () => {
    appendModuleMapEvent(root, { ts: '2026-05-28T00:00:00.000Z', type: 'module.declared' });
    // Append a malformed line by hand.
    const path = join(root, PATHS.MODULE_MAP_EVENTS_LOG);
    const raw = readFileSync(path, 'utf8');
    writeFileSync(path, raw + 'not-json\n');
    const events = readModuleMapEvents(root);
    expect(events).toHaveLength(1);
  });

  it('readModuleMapEventsSince filters by timestamp', () => {
    appendModuleMapEvent(root, {
      ts: '2026-05-28T00:00:00.000Z',
      type: 'module.declared',
      slug: 'a',
    });
    appendModuleMapEvent(root, {
      ts: '2026-05-30T00:00:00.000Z',
      type: 'module.declared',
      slug: 'b',
    });
    expect(readModuleMapEventsSince(root, '2026-05-29T00:00:00.000Z')).toHaveLength(1);
    expect(readModuleMapEventsSince(root, '2026-05-29T00:00:00.000Z')[0]?.slug).toBe('b');
  });

  it('readModuleMapEventsForSlug filters by slug', () => {
    appendModuleMapEvent(root, {
      ts: '2026-05-28T00:00:00.000Z',
      type: 'module.declared',
      slug: 'a',
    });
    appendModuleMapEvent(root, {
      ts: '2026-05-28T00:01:00.000Z',
      type: 'module.declared',
      slug: 'b',
    });
    expect(readModuleMapEventsForSlug(root, 'a')).toHaveLength(1);
    expect(readModuleMapEventsForSlug(root, 'a')[0]?.slug).toBe('a');
  });
});
