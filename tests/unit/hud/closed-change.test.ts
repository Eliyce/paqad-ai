import { afterEach, describe, expect, it } from 'vitest';

import { recordShip } from '@/feature-evidence/delivery.js';
import { appendFeatureStageRow, closeActiveFeature } from '@/feature-evidence/stage-ledger.js';
import { buildHudSnapshot, closedChangeOf } from '@/hud/snapshot.js';

import {
  DELIVERY_MISSING,
  NEW_COMMITS_AFTER_CLOSE,
  buildDesktopBand,
  deliveryView,
} from '../../../runtime/claude-plugin/mod/desktop-view.ts';
import { parseSnapshot } from '../../../runtime/claude-plugin/mod/model.ts';
import { cleanupScopeFixtures, openChangeHere, repoRoot, runStage } from './scope-fixtures.js';

const S = 'ses-closed';
const PR = {
  number: 4242,
  url: 'https://example.test/pull/4242',
  draft: false,
};

afterEach(() => cleanupScopeFixtures());

function closedChange(withPr: boolean) {
  const root = repoRoot();
  const dir = openChangeHere(root, S);
  runStage(root, S, 'development');
  if (withPr) recordShip(root, dir, { pr: PR }, new Date().toISOString());
  appendFeatureStageRow(root, S, dir, {
    kind: 'close',
    event_status: 'completed',
    note: 'closed; bundle=complete',
  });
  closeActiveFeature(root, S);
  return buildHudSnapshot(root, S);
}

function band(snapshot: ReturnType<typeof parseSnapshot>) {
  return buildDesktopBand({
    snapshot,
    unbound: false,
    unavailable: false,
    now: Date.now(),
    turnStartedAt: null,
    visibility: { minimised: false, closed: false, hidden: false },
    menuOpen: false,
    columns: 93,
    maxRows: 12,
  });
}

describe('AC-10: after the close row the band shows the change as closed', () => {
  it('the snapshot is not active and keeps the closed change and its PR', () => {
    const snapshot = closedChange(true);
    expect(snapshot.active).toBe(false);
    expect(snapshot.closed_change).toMatchObject({ new_commits: 0 });
    expect(snapshot.ship?.pr?.number).toBe(4242);
    const drawn = band(parseSnapshot(JSON.stringify(snapshot)));
    expect(drawn).toMatchObject({
      kind: 'closed-change',
      pr: { text: 'PR #4242', href: PR.url },
      note: null,
    });
    expect(deliveryView(parseSnapshot(JSON.stringify(snapshot))!).empty).toBeNull();
  });

  it('with no delivery record or no PR link the band says Delivery missing, never done', () => {
    const drawn = band(parseSnapshot(JSON.stringify(closedChange(false))));
    expect(drawn).toMatchObject({ kind: 'closed-change', pr: null });
    expect(DELIVERY_MISSING).toBe('Delivery missing');
  });
});

describe('AC-19: commits after the close row keep the band closed with a note', () => {
  it('counts only the commits after the close', () => {
    const rows = [
      { kind: 'open', recorded_at: '2026-11-11T08:00:00.000Z' },
      { kind: 'close', recorded_at: '2026-11-11T16:20:00.000Z' },
    ];
    expect(
      closedChangeOf(rows, null, ['2026-11-11T16:00:00.000Z', '2026-11-11T17:00:00.000Z']),
    ).toEqual({ closed_at: '2026-11-11T16:20:00.000Z', word: null, new_commits: 1 });
    expect(
      closedChangeOf(
        [...rows, { kind: 'open', recorded_at: '2026-11-12T08:00:00.000Z' }],
        null,
        [],
      ),
    ).toBeNull();
  });

  it('the band stays closed with the PR and says new commits after close', () => {
    const snapshot = parseSnapshot(JSON.stringify(closedChange(true)))!;
    const later = { ...snapshot, closed_change: { ...snapshot.closed_change!, new_commits: 2 } };
    expect(band(later)).toMatchObject({
      kind: 'closed-change',
      pr: { text: 'PR #4242' },
      note: NEW_COMMITS_AFTER_CLOSE,
    });
  });
});
