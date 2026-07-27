import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SITE_MAP_RUN_DOC_TYPE,
  recordSiteMapRun,
  type SiteMapRunLedgerSummary,
} from '@/site-map/ledger.js';
import { readAllSessionRows } from '@/session-ledger/ledger.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-sitemap-ledger-'));
}

function summary(overrides: Partial<SiteMapRunLedgerSummary> = {}): SiteMapRunLedgerSummary {
  return {
    report_id: 'SITEMAP-2026',
    workflow: 'site-map',
    surface_count: 17,
    journey_count: 3,
    finding_count: 2,
    blocked_count: 1,
    new_since_baseline: 2,
    pre_existing: 0,
    ...overrides,
  };
}

describe('recordSiteMapRun', () => {
  it('writes a site-map-run row on the shared session ledger', () => {
    const root = repo();
    const result = recordSiteMapRun(root, summary(), {
      sessionId: 's-1',
      now: () => new Date(2026, 0, 1),
    });
    expect(result).not.toBeNull();
    const rows = readAllSessionRows(root, SITE_MAP_RUN_DOC_TYPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report_id).toBe('SITEMAP-2026');
    expect(rows[0]!.surface_count).toBe(17);
    expect(rows[0]!.event_status).toBe('findings');
  });

  it('marks a clean run when there are no findings', () => {
    const root = repo();
    recordSiteMapRun(root, summary({ finding_count: 0 }), { sessionId: 's-2' });
    const rows = readAllSessionRows(root, SITE_MAP_RUN_DOC_TYPE);
    expect(rows[0]!.event_status).toBe('clean');
  });

  it('is best-effort and never throws on a bad root', () => {
    expect(() => recordSiteMapRun('\0not-a-real-path', summary())).not.toThrow();
  });
});
