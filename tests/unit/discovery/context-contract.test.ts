import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTEXT_MODES,
  DISCOVERY_STAGE_CONTEXT,
  extraContextItems,
  hasStageContract,
  isContextMode,
  stageContextContract,
} from '@/discovery/context-contract.js';
import { recordContextReceipt } from '@/discovery/context-receipts.js';
import { DISCOVERY_STAGE_ORDER } from '@/discovery/stages.js';
import { discoveryRunFilePath } from '@/discovery/paths.js';
import { openDiscoveryRun } from '@/discovery/run-store.js';
import type { DiscoveryWriteContext } from '@/discovery/writers.js';

const roots: string[] = [];
function ctx(): DiscoveryWriteContext & { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-discovery-ctx-'));
  roots.push(root);
  const { dirName } = openDiscoveryRun(root, { sessionId: 's', title: 'idea', adapter: 'x' });
  return { projectRoot: root, dirName, sessionId: 's', root };
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function readReceipts(root: string, path: string): Record<string, unknown>[] {
  return readFileSync(join(root, path), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('discovery context contract', () => {
  it('declares a bounded default set for every stage', () => {
    for (const stage of DISCOVERY_STAGE_ORDER) {
      expect(stageContextContract(stage).length).toBeGreaterThan(0);
      expect(hasStageContract(stage)).toBe(true);
    }
    expect(stageContextContract('development')).toEqual([]);
    expect(hasStageContract('development')).toBe(false);
    expect(Object.keys(DISCOVERY_STAGE_CONTEXT)).toHaveLength(6);
  });

  it('computes extra items beyond the default', () => {
    const defaults = stageContextContract('understand');
    expect(extraContextItems('understand', [...defaults])).toEqual([]);
    expect(extraContextItems('understand', [...defaults, 'the-whole-rulebook'])).toEqual([
      'the-whole-rulebook',
    ]);
    // Unknown stage: everything is extra.
    expect(extraContextItems('nope', ['x'])).toEqual(['x']);
  });

  it('guards context modes (no "understood")', () => {
    expect(CONTEXT_MODES).toEqual(['available', 'read', 'acknowledged']);
    expect(isContextMode('read')).toBe(true);
    expect(isContextMode('understood')).toBe(false);
  });
});

describe('discovery context receipts', () => {
  it('records a bounded-default receipt with a null reason', () => {
    const c = ctx();
    const res = recordContextReceipt(c, {
      stage: 'understand',
      items: [...stageContextContract('understand')],
      mode: 'read',
    });
    expect(res.ok).toBe(true);
    expect(res.extra).toEqual([]);
    const rows = readReceipts(c.root, discoveryRunFilePath(c.dirName, 'contextReceipts'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBeNull();
    expect(rows[0]!.mode).toBe('read');
  });

  it('refuses extra context with no reason, and records it with a reason', () => {
    const c = ctx();
    const denied = recordContextReceipt(c, {
      stage: 'refine',
      items: [...stageContextContract('refine'), 'the-entire-rulebook'],
      mode: 'read',
    });
    expect(denied.ok).toBe(false);
    expect(denied.extra).toContain('the-entire-rulebook');
    // Nothing written on refusal.
    expect(() =>
      readReceipts(c.root, discoveryRunFilePath(c.dirName, 'contextReceipts')),
    ).toThrow();

    const allowed = recordContextReceipt(c, {
      stage: 'refine',
      items: [...stageContextContract('refine'), 'the-entire-rulebook'],
      mode: 'read',
      reason: 'the change touches a rule not in the default set',
    });
    expect(allowed.ok).toBe(true);
    const rows = readReceipts(c.root, discoveryRunFilePath(c.dirName, 'contextReceipts'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('the change touches a rule not in the default set');
  });

  it('refuses an invalid mode', () => {
    const c = ctx();
    const res = recordContextReceipt(c, {
      stage: 'understand',
      items: [],
      mode: 'understood' as never,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mode/);
  });
});
