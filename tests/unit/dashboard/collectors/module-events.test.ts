import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectModuleEvents } from '@/dashboard/collectors/module-events';
import { appendModuleMapEvent } from '@/module-decisions/events';

describe('collectModuleEvents', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-me-coll-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown band when events.jsonl is absent', () => {
    const result = collectModuleEvents(root);
    expect(result.section.band).toBe('unknown');
    expect(result.section.score).toBeNull();
    expect(result.attention).toEqual([]);
  });

  it('groups entries by type and records the last timestamp per type', () => {
    appendModuleMapEvent(root, { ts: '2026-05-20T00:00:00Z', type: 'module.declared', slug: 'a' });
    appendModuleMapEvent(root, { ts: '2026-05-21T00:00:00Z', type: 'module.reconciled' });
    appendModuleMapEvent(root, { ts: '2026-05-22T00:00:00Z', type: 'module.reconciled' });
    appendModuleMapEvent(root, { ts: '2026-05-23T00:00:00Z', type: 'module.health.rolled-up' });

    const result = collectModuleEvents(root);
    expect(result.section.band).toBe('green');
    expect(result.section.score).toBe(100);
    const details = result.section.details as {
      total: number;
      counts: Record<string, number>;
      last_by_type: Record<string, string>;
    };
    expect(details.total).toBe(4);
    expect(details.counts['module.reconciled']).toBe(2);
    expect(details.last_by_type['module.reconciled']).toBe('2026-05-22T00:00:00Z');
    expect(details.last_by_type['module.health.rolled-up']).toBe('2026-05-23T00:00:00Z');
  });
});
