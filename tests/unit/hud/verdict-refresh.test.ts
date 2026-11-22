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

describe('newest change evidence', () => {
  it('AC-9 reads the checks report time when the stage ledger cannot be read', async () => {
    const { featureChecksPath } = await import('@/checks/report-store.js');
    const { featureStagePath } = await import('@/feature-evidence/stage-ledger.js');
    const { newestChangeEvidenceAt } = await import('@/hud/verdict-refresh.js');
    const { writeFileSync } = await import('node:fs');
    const root = project();
    const dir = openChange(root, 'ses-n');
    const rows = newestChangeEvidenceAt(root, dir);
    expect(rows).toEqual(expect.any(Number));
    const later = '2999-01-01T00:00:00.000Z';
    writeFileSync(
      featureChecksPath(root, dir),
      JSON.stringify({ passed: true, results: [], generated_at: later }),
    );
    expect(newestChangeEvidenceAt(root, dir)).toBe(Date.parse(later));
    rmSync(join(root, featureStagePath(dir)));
    mkdirSync(join(root, featureStagePath(dir)));
    writeFileSync(
      featureChecksPath(root, dir),
      JSON.stringify({ passed: true, results: [], recorded_at: 'not a date' }),
    );
    expect(newestChangeEvidenceAt(root, dir)).toBeNull();
  });

  it('AC-9 treats a verdict with an unreadable write time as stale and one without a change as fresh', () => {
    const root = project();
    const found = (record: Record<string, unknown>) =>
      ({ status: 'found', record }) as unknown as Parameters<typeof hudVerdictIsStale>[1];
    expect(hudVerdictIsStale(root, found({ change: 'c', written_at: 'garbage' }))).toBe(true);
    expect(hudVerdictIsStale(root, found({ change: null, written_at: 'garbage' }))).toBe(false);
  });
});
