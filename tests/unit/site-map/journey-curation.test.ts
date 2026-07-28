import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Journey } from '@/core/types/site-map.js';
import {
  confirmJourney,
  curateJourney,
  rejectJourney,
  runJourneyCuration,
} from '@/site-map/journey-curation.js';
import { SITE_MAP_JOURNEY_CURATION_DOC_TYPE, recordJourneyCuration } from '@/site-map/ledger.js';
import { readJourney, removeJourney, writeJourney } from '@/site-map/store.js';
import { readAllSessionRows } from '@/session-ledger/ledger.js';

import { minimalJourney } from '../../fixtures/site-map/valid-app-map.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'sm-journey-'));
}

function proposed(overrides: Partial<Journey> = {}): Journey {
  return { ...minimalJourney(), status: 'proposed', ...overrides };
}

describe('journey curation (pure)', () => {
  it('confirms a proposed journey, marking it confirmed and human-derived', () => {
    const result = confirmJourney(proposed());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.journey?.status).toBe('confirmed');
    expect(result.journey?.derivation).toBe('human');
    expect(result.removed).toBe(false);
  });

  it('refuses to confirm a journey that is not proposed', () => {
    const result = confirmJourney(proposed({ status: 'locked' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not proposed');
  });

  it('rejects (removes) a proposed journey but refuses a confirmed one', () => {
    const ok = rejectJourney(proposed());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.removed).toBe(true);

    const refused = rejectJourney(proposed({ status: 'confirmed' }));
    expect(refused.ok).toBe(false);
  });

  it('curateJourney dispatches on the action', () => {
    expect(curateJourney(proposed(), 'confirm').ok).toBe(true);
    const rej = curateJourney(proposed(), 'reject');
    expect(rej.ok && rej.removed).toBe(true);
  });
});

describe('runJourneyCuration', () => {
  it('fails when the journey does not exist', () => {
    const result = runJourneyCuration({ projectRoot: repo(), id: 'ghost', action: 'confirm' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no journey');
  });

  it('confirms a proposed journey on disk and records an audit row', () => {
    const root = repo();
    writeJourney(root, proposed({ id: 'checkout' }));
    const result = runJourneyCuration({
      projectRoot: root,
      id: 'checkout',
      action: 'confirm',
      sessionId: 's-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('confirmed');
    expect(readJourney(root, 'checkout')?.status).toBe('confirmed');

    const rows = readAllSessionRows(root, SITE_MAP_JOURNEY_CURATION_DOC_TYPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_status).toBe('confirmed');
  });

  it('rejects a proposed journey by removing its file', () => {
    const root = repo();
    writeJourney(root, proposed({ id: 'abandoned' }));
    const result = runJourneyCuration({ projectRoot: root, id: 'abandoned', action: 'reject' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('removed');
    expect(readJourney(root, 'abandoned')).toBeNull();
  });

  it('refuses to curate a non-proposed journey', () => {
    const root = repo();
    writeJourney(root, minimalJourney()); // status: confirmed
    const result = runJourneyCuration({
      projectRoot: root,
      id: 'onboard',
      action: 'confirm',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not proposed');
  });
});

describe('curation store + ledger edges', () => {
  it('removeJourney returns false when no file exists', () => {
    expect(removeJourney(repo(), 'ghost')).toBe(false);
  });

  it('recordJourneyCuration is best-effort and never throws on a bad root', () => {
    expect(() =>
      recordJourneyCuration('\0not-a-real-path', {
        journey_id: 'x',
        action: 'reject',
        status: 'removed',
      }),
    ).not.toThrow();
  });
});
