import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  analyticsEventDocPath,
  analyticsIndexPath,
  buildAnalyticsIndex,
  buildEventDoc,
  groupBySlug,
  normalizeEventSlug,
  syncAnalyticsDocs,
} from '@/analytics/doc-tree.js';

describe('analytics doc-tree (issue #279)', () => {
  it('normalizes casing and separators to one slug', () => {
    expect(normalizeEventSlug('Song Played')).toBe('song-played');
    expect(normalizeEventSlug('song played')).toBe('song-played');
    expect(normalizeEventSlug('song_played')).toBe('song-played');
    expect(normalizeEventSlug('  Checkout--Started!! ')).toBe('checkout-started');
  });

  it('builds a module-owned, feature-nested doc path', () => {
    expect(analyticsEventDocPath('users', 'playback', 'Song Played')).toBe(
      join('docs', 'modules', 'users', 'analytics', 'playback', 'song-played.md'),
    );
    expect(analyticsIndexPath('users')).toBe(
      join('docs', 'modules', 'users', 'analytics', 'index.md'),
    );
  });

  it('collapses casing variants to one group and flags the conflict', () => {
    const groups = groupBySlug([
      { provider: 'posthog', eventName: 'Song Played' },
      { provider: 'segment', eventName: 'song played' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].slug).toBe('song-played');
    expect(groups[0].variants).toEqual(['Song Played', 'song played']);
    expect(groups[0].providers).toEqual(['posthog', 'segment']);
  });

  it('returns groups sorted by slug', () => {
    const groups = groupBySlug([
      { provider: 'posthog', eventName: 'zeta_event' },
      { provider: 'posthog', eventName: 'alpha_event' },
    ]);
    expect(groups.map((g) => g.slug)).toEqual(['alpha-event', 'zeta-event']);
  });

  it('renders the exact event string, a section per provider, and a PII section', () => {
    const [group] = groupBySlug([{ provider: 'posthog', eventName: 'checkout_started' }]);
    const doc = buildEventDoc({ module: 'checkout', feature: 'cart', group });
    expect(doc).toContain('# Event: `checkout_started`');
    expect(doc).toContain('### PostHog');
    expect(doc).toContain('Event string: `checkout_started`');
    expect(doc).toContain('## PII / consent');
    expect(doc).toContain('analytics.pii_consent');
  });

  it('skips call-sites whose name normalizes to an empty slug', () => {
    expect(groupBySlug([{ provider: 'posthog', eventName: '---' }])).toEqual([]);
  });

  it('renders an empty per-module index with a placeholder', () => {
    const index = buildAnalyticsIndex({ module: 'checkout', entries: [] });
    expect(index).toContain('# Analytics events — `checkout`');
    expect(index).toContain('_No analytics events documented for this module yet._');
  });

  it('lists events in the per-module index', () => {
    const [group] = groupBySlug([{ provider: 'posthog', eventName: 'checkout_started' }]);
    const index = buildAnalyticsIndex({
      module: 'checkout',
      entries: [{ feature: 'cart', group }],
    });
    expect(index).toContain('# Analytics events — `checkout`');
    expect(index).toContain('`checkout_started`');
    expect(index).toContain('cart/checkout-started.md');
  });

  it('sorts index rows by feature then slug', () => {
    const [a] = groupBySlug([{ provider: 'posthog', eventName: 'zzz_last' }]);
    const [b] = groupBySlug([{ provider: 'posthog', eventName: 'aaa_first' }]);
    const index = buildAnalyticsIndex({
      module: 'm',
      entries: [
        { feature: 'cart', group: a },
        { feature: 'cart', group: b },
      ],
    });
    expect(index.indexOf('aaa-first')).toBeLessThan(index.indexOf('zzz-last'));
  });

  describe('syncAnalyticsDocs', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-analytics-docs-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('writes per-event docs + a per-module index, then skips unchanged on re-run', async () => {
      const entries = [
        {
          module: 'checkout',
          feature: 'cart',
          callSites: [{ provider: 'posthog' as const, eventName: 'checkout_started' }],
        },
      ];
      const first = await syncAnalyticsDocs(root, entries);
      expect(first.written).toContain(
        join('docs', 'modules', 'checkout', 'analytics', 'cart', 'checkout-started.md'),
      );
      expect(first.written).toContain(analyticsIndexPath('checkout'));
      expect(first.conflicts).toHaveLength(0);
      expect(
        readFileSync(
          join(root, 'docs', 'modules', 'checkout', 'analytics', 'cart', 'checkout-started.md'),
          'utf8',
        ),
      ).toContain('checkout_started');

      const second = await syncAnalyticsDocs(root, entries);
      expect(second.written).toHaveLength(0);
      expect(second.skipped.length).toBeGreaterThan(0);
    });

    it('collapses a casing conflict to one doc and reports it (AC-4)', async () => {
      const result = await syncAnalyticsDocs(root, [
        {
          module: 'users',
          feature: 'playback',
          callSites: [
            { provider: 'posthog', eventName: 'Song Played' },
            { provider: 'segment', eventName: 'song played' },
          ],
        },
      ]);
      const docPath = join('docs', 'modules', 'users', 'analytics', 'playback', 'song-played.md');
      expect(result.written).toContain(docPath);
      expect(result.conflicts).toEqual([
        { path: docPath, variants: ['Song Played', 'song played'] },
      ]);
      const doc = readFileSync(join(root, docPath), 'utf8');
      expect(doc).toContain('Casing conflict');
    });

    it('re-renders a doc whose content changed', async () => {
      const docAbs = join(root, 'docs', 'modules', 'm', 'analytics', 'f', 'e.md');
      mkdirSync(join(root, 'docs', 'modules', 'm', 'analytics', 'f'), { recursive: true });
      writeFileSync(docAbs, 'stale');
      const result = await syncAnalyticsDocs(root, [
        {
          module: 'm',
          feature: 'f',
          callSites: [{ provider: 'posthog', eventName: 'e' }],
        },
      ]);
      expect(result.written).toContain(join('docs', 'modules', 'm', 'analytics', 'f', 'e.md'));
    });
  });
});
