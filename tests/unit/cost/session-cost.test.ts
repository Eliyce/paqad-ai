import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readCostCache, updateSessionCostCache } from '@/cost/change-cost.js';
import { workflowCostSince } from '@/cost/session-cost.js';
import { hudCostCachePath } from '@/hud/files.js';

import { SES, assistant, at, total, writeTranscript } from './cost.fixture.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-session-cost-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const A = { input: 10, output: 200, cacheRead: 3000, cacheWrite: 400 };
const B = { input: 20, output: 300, cacheRead: 5000, cacheWrite: 500 };

describe('the session cost cache with no change', () => {
  it('keeps the main transcript from the floor and writes no bundle', () => {
    const root = tempRoot();
    const main = writeTranscript(root, 'main', [
      assistant('old', '09:00', A),
      assistant('m1', '10:05', A),
      assistant('m2', '10:20', B),
    ]);
    const cache = updateSessionCostCache({
      projectRoot: root,
      sessionId: SES,
      payload: { transcript_path: main },
      floor: at('10:00'),
    })!;
    expect(Object.keys(cache.sources[main]!.messages).sort()).toEqual(['m1', 'm2']);
    expect(cache.sources[main]!.changes).toEqual([]);
    expect(existsSync(join(root, '.paqad/ledger/feature-evidence'))).toBe(false);
    expect(readdirSync(join(root, '.paqad/session/hud'))).toContain(`${SES}.cost-cache.json`);
  });

  it('lowers the floor and reads again when an earlier floor is asked for', () => {
    const root = tempRoot();
    const main = writeTranscript(root, 'main', [
      assistant('old', '09:00', A),
      assistant('m1', '10:05', B),
    ]);
    const input = { projectRoot: root, sessionId: SES, payload: { transcript_path: main } };
    updateSessionCostCache({ ...input, floor: at('10:00') });
    updateSessionCostCache({ ...input, floor: at('10:30') });
    expect(
      Object.keys(readCostCache(hudCostCachePath(root, SES), SES).sources[main]!.messages),
    ).toEqual(['m1']);
    const lowered = updateSessionCostCache({ ...input, floor: at('08:00') })!;
    expect(Object.keys(lowered.sources[main]!.messages).sort()).toEqual(['m1', 'old']);
  });

  it('does nothing without a main transcript', () => {
    const root = tempRoot();
    expect(
      updateSessionCostCache({
        projectRoot: root,
        sessionId: SES,
        payload: {},
        floor: at('10:00'),
      }),
    ).toBeNull();
  });
});

describe('workflowCostSince', () => {
  it('counts only main messages at or after the workflow started', () => {
    const root = tempRoot();
    const main = writeTranscript(root, 'main', [
      assistant('m1', '10:05', A),
      assistant('m2', '10:20', B),
      assistant('m3', '10:25', B, { model: 'claude-future-9' }),
    ]);
    updateSessionCostCache({
      projectRoot: root,
      sessionId: SES,
      payload: { transcript_path: main },
      floor: at('10:00'),
    });
    const cost = workflowCostSince(root, SES, at('10:20'));
    expect(cost.tokens).toBe(total(B) * 2);
    expect(cost.usd).toBeGreaterThan(0);
    expect(cost.unpriced).toEqual(['claude-future-9']);
    expect(workflowCostSince(root, SES, at('10:21')).usd).toBeNull();
  });

  it('reads tokens unknown with no cache or a bad start', () => {
    const root = tempRoot();
    expect(workflowCostSince(root, SES, at('10:00'))).toEqual({
      tokens: null,
      usd: null,
      unpriced: [],
    });
    const main = writeTranscript(root, 'main', [assistant('m1', '10:05', A)]);
    updateSessionCostCache({
      projectRoot: root,
      sessionId: SES,
      payload: { transcript_path: main },
      floor: at('10:00'),
    });
    expect(workflowCostSince(root, SES, 'never').tokens).toBeNull();
    expect(workflowCostSince(root, SES, at('11:00')).tokens).toBe(0);
  });
});
