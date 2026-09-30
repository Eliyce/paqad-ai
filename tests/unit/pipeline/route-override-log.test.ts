import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendRouteOverride, readRouteOverrides } from '@/pipeline/route-override-log.js';

describe('route-override-log (#580)', () => {
  let root: string;
  const SES = 'ses-override';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-override-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appends and reads agent-override rows in order', () => {
    appendRouteOverride(root, SES, {
      hookLabel: 'feature-development',
      agentLabel: 'project-question',
      reason: 'a question',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    appendRouteOverride(root, SES, {
      hookLabel: 'project-question',
      agentLabel: 'documentation-update',
      now: () => new Date('2026-01-02T00:00:00.000Z'),
    });

    const rows = readRouteOverrides(root, SES);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      source: 'agent-override',
      ts: '2026-01-01T00:00:00.000Z',
      hook_label: 'feature-development',
      agent_label: 'project-question',
      reason: 'a question',
    });
    expect(rows[1]).toMatchObject({
      hook_label: 'project-question',
      agent_label: 'documentation-update',
    });
    expect(rows[1]).not.toHaveProperty('reason');
  });

  it('records a null hook label', () => {
    appendRouteOverride(root, SES, { hookLabel: null, agentLabel: 'project-question' });
    expect(readRouteOverrides(root, SES)[0]?.hook_label).toBeNull();
  });

  it('returns [] for a session with no overrides', () => {
    expect(readRouteOverrides(root, 'nobody')).toEqual([]);
  });
});
