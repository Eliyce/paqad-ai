import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ANALYTICS_CONFLICTS,
  ANALYTICS_DECISION_PATH,
  conflictCategory,
  detectAnalyticsProvider,
  extractCallSites,
  findProvider,
  inferNamingConvention,
  resolveAnalyticsGate,
  resolveAndPersistAnalyticsGate,
} from '@/analytics/index.js';
import { detectAnalyticsSignals } from '@/detection/signals/analytics-provider.js';

let root: string;
const clock = () => new Date(1_700_000_000_000);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-analytics-agent-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePkg(deps: Record<string, string>): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }), 'utf8');
}
function writeSrc(rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text, 'utf8');
}

describe('providers', () => {
  it('findProvider resolves by id and returns undefined for unknown', () => {
    expect(findProvider('ga4')?.displayName).toBe('Google Analytics 4');
    expect(findProvider('nope')).toBeUndefined();
  });
});

describe('extractCallSites', () => {
  it('extracts (provider, event) pairs and de-dupes', () => {
    const sites = extractCallSites(
      "posthog.capture('checkout_completed'); posthog.capture('checkout_completed'); analytics.track('signup_started');",
    );
    expect(sites).toContainEqual({ provider: 'posthog', eventName: 'checkout_completed' });
    expect(sites).toContainEqual({ provider: 'segment', eventName: 'signup_started' });
    expect(sites).toHaveLength(2);
  });
  it('returns [] when no analytics calls are present', () => {
    expect(extractCallSites('const x = 1;')).toEqual([]);
  });
});

describe('inferNamingConvention', () => {
  it('classifies snake / camel / title / mixed / empty', () => {
    expect(inferNamingConvention([])).toBeNull();
    expect(inferNamingConvention(['checkout_completed', 'signup_started'])).toBe('snake_case');
    expect(inferNamingConvention(['checkoutCompleted'])).toBe('camelCase');
    expect(inferNamingConvention(['Order Completed', 'Signup Started'])).toBe('Title Case');
    expect(inferNamingConvention(['Order Completed', 'checkout_completed'])).toBe('mixed');
  });
});

describe('detectAnalyticsProvider', () => {
  it('AC-6: detects a provider from deps + call site with the convention', () => {
    writePkg({ 'posthog-js': '^1.0.0' });
    writeSrc('src/track.ts', "posthog.capture('checkout_completed');");
    const detection = detectAnalyticsProvider(root);
    expect(detection?.provider).toBe('posthog');
    expect(detection?.confidence).toBe('high');
    expect(detection?.convention).toBe('snake_case');
    expect(detection?.signals.length).toBeGreaterThan(0);
  });

  it('detects a provider listed under devDependencies', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ devDependencies: { 'plausible-tracker': '^0.3.0' } }),
      'utf8',
    );
    expect(detectAnalyticsProvider(root)?.provider).toBe('plausible');
  });

  it('detects GA4 from a script tag alone (no npm dep)', () => {
    writeFileSync(
      join(root, 'index.html'),
      '<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234"></script>',
      'utf8',
    );
    expect(detectAnalyticsProvider(root)?.provider).toBe('ga4');
  });

  it('a dependency alone (no call site) yields medium confidence', () => {
    writePkg({ 'mixpanel-browser': '^2.0.0' });
    const detection = detectAnalyticsProvider(root);
    expect(detection?.provider).toBe('mixpanel');
    expect(detection?.confidence).toBe('medium');
    expect(detection?.convention).toBeNull();
  });

  it('picks the higher-scoring provider when several are present', () => {
    writePkg({ 'posthog-js': '^1.0.0', '@segment/analytics-next': '^1.0.0' });
    // posthog also has a call site, so it outscores segment (dep only).
    writeSrc('src/track.ts', "posthog.capture('checkout_completed')");
    expect(detectAnalyticsProvider(root)?.provider).toBe('posthog');
  });

  it('an env key alone yields a low-confidence detection', () => {
    writeFileSync(join(root, '.env'), 'SEGMENT_WRITE_KEY=abc123', 'utf8');
    const detection = detectAnalyticsProvider(root);
    expect(detection?.provider).toBe('segment');
    expect(detection?.confidence).toBe('low');
  });

  it('returns null when nothing is wired', () => {
    writePkg({ react: '^18.0.0' });
    expect(detectAnalyticsProvider(root)).toBeNull();
  });

  it('walks nested source dirs and skips non-source files', () => {
    writePkg({ 'posthog-js': '^1.0.0' });
    writeSrc('src/nested/deep/track.ts', "posthog.capture('deep_event')");
    writeSrc('src/README.md', 'posthog.capture("not_code")');
    const detection = detectAnalyticsProvider(root);
    expect(detection?.provider).toBe('posthog');
    // The .md file is not scanned, so only the .ts call site contributes an event.
    expect(detection?.signals.some((s) => s.signal.includes('deep_event'))).toBe(true);
  });

  it('detectAnalyticsSignals wraps the detector', () => {
    writePkg({ 'mixpanel-browser': '^2.0.0' });
    expect(detectAnalyticsSignals(root).some((s) => s.implies === 'mixpanel')).toBe(true);
    expect(detectAnalyticsSignals(root).length).toBeGreaterThan(0);
  });
});

describe('resolveAnalyticsGate (cheapest-first)', () => {
  it('AC-7: flag OFF short-circuits before detection', () => {
    writePkg({ 'posthog-js': '^1.0.0' });
    writeSrc('src/t.ts', "posthog.capture('x')");
    const decision = resolveAnalyticsGate({
      projectRoot: root,
      flagEnabled: false,
      changeIsFeatureShaped: true,
      now: clock,
    });
    expect(decision.status).toBe('off');
    expect(decision.provider).toBeUndefined();
  });

  it('not-feature-shaped ⇒ not_applicable', () => {
    expect(
      resolveAnalyticsGate({
        projectRoot: root,
        flagEnabled: true,
        changeIsFeatureShaped: false,
        now: clock,
      }).status,
    ).toBe('not_applicable');
  });

  it('enabled + feature-shaped + no provider ⇒ dormant', () => {
    expect(
      resolveAnalyticsGate({
        projectRoot: root,
        flagEnabled: true,
        changeIsFeatureShaped: true,
        now: clock,
      }).status,
    ).toBe('dormant');
  });

  it('enabled + feature-shaped + provider ⇒ instrument with provider details', () => {
    writePkg({ 'posthog-js': '^1.0.0' });
    writeSrc('src/t.ts', "posthog.capture('checkout_completed')");
    const decision = resolveAnalyticsGate({
      projectRoot: root,
      flagEnabled: true,
      changeIsFeatureShaped: true,
      now: clock,
    });
    expect(decision.status).toBe('instrument');
    expect(decision.provider).toBe('posthog');
  });

  it('resolveAndPersistAnalyticsGate writes the carry-forward sidecar', () => {
    const decision = resolveAndPersistAnalyticsGate({
      projectRoot: root,
      flagEnabled: true,
      changeIsFeatureShaped: false,
      now: clock,
    });
    expect(decision.status).toBe('not_applicable');
    const sidecar = join(root, ANALYTICS_DECISION_PATH);
    expect(existsSync(sidecar)).toBe(true);
    expect(JSON.parse(readFileSync(sidecar, 'utf8')).status).toBe('not_applicable');
  });
});

describe('conflicts', () => {
  it('every conflict maps to an analytics decision category', () => {
    for (const kind of Object.keys(ANALYTICS_CONFLICTS) as (keyof typeof ANALYTICS_CONFLICTS)[]) {
      expect(conflictCategory(kind)).toMatch(/^analytics\./);
      expect(ANALYTICS_CONFLICTS[kind].title.length).toBeGreaterThan(0);
    }
  });
});
