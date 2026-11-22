import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeHudReceipt } from '@/hud/receipt-file.js';
import { hudVerdictIsStale, readFreshHudVerdict } from '@/hud/verdict-refresh.js';

import { openChange } from '../traceability/change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-verdict-refresh-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

describe('status --verdict refresh', () => {
  it('AC-9 re-judges a verdict record older than the newest ledger row and prints the fresh one', async () => {
    const root = project();
    const dir = openChange(root, 'ses-v');
    writeHudReceipt(
      root,
      'ses-v',
      { summary: 'old', gates: [], kind: 'fail', change: dir },
      () => new Date('2000-01-01T00:00:00.000Z'),
    );
    let judged = 0;
    const reading = await readFreshHudVerdict(root, 'ses-v', async (projectRoot, session) => {
      judged += 1;
      writeHudReceipt(projectRoot, session, {
        summary: 'new',
        gates: [],
        kind: 'pass',
        change: dir,
      });
    });
    expect(judged).toBe(1);
    expect(reading.status === 'found' && reading.record.kind).toBe('pass');
    expect(hudVerdictIsStale(root, reading)).toBe(false);
    const again = await readFreshHudVerdict(root, 'ses-v', async () => {
      judged += 1;
    });
    expect(judged).toBe(1);
    expect(again.status).toBe('found');
  });
});
