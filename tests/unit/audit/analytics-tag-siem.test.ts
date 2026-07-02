import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aggregateSiemEvents } from '@/audit/aggregate';
import { recordAnalyticsTag } from '@/analytics-tag/recorder';
import { ANALYTICS_TAG_DOC_TYPE } from '@/analytics-tag/types';

describe('analytics-tag SIEM inclusion (issue #241)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-atsiem-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-11: a recorded tag surfaces in the SIEM export with a tag detail', () => {
    recordAnalyticsTag(
      root,
      { tagName: 'checkout_completed', tagProvider: 'ga4', sourcePath: 'src/x.ts' },
      { sessionId: 'ses_siem', adapter: 'claude-code', analyticsEnabled: true },
    );
    const events = aggregateSiemEvents(root);
    const analytics = events.filter(
      (e) => e.kind === 'session' && e.doc_type === ANALYTICS_TAG_DOC_TYPE,
    );
    expect(analytics.length).toBeGreaterThan(0);
    expect(analytics.some((e) => e.detail.includes('tag checkout_completed'))).toBe(true);
  });
});
