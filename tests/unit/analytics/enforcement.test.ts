import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  evaluateAnalyticsCompleteness,
  evaluateAnalyticsCompletenessForProject,
  resolveAnalyticsStrictness,
  type InstrumentedEvent,
} from '@/analytics/enforcement.js';

const events: InstrumentedEvent[] = [
  { module: 'checkout', feature: 'cart', eventName: 'checkout_started' },
];

describe('analytics enforcement (issue #279)', () => {
  describe('evaluateAnalyticsCompleteness', () => {
    it('off is always ok, even with missing docs', () => {
      const result = evaluateAnalyticsCompleteness({ mode: 'off', events, docExists: () => false });
      expect(result).toEqual({ mode: 'off', verdict: 'ok', missingDocs: [] });
    });

    it('warn reports a missing event doc as a non-blocking warn', () => {
      const result = evaluateAnalyticsCompleteness({
        mode: 'warn',
        events,
        docExists: () => false,
      });
      expect(result.verdict).toBe('warn');
      expect(result.missingDocs).toEqual([
        join('docs', 'modules', 'checkout', 'analytics', 'cart', 'checkout-started.md'),
      ]);
    });

    it('strict blocks on a missing event doc', () => {
      const result = evaluateAnalyticsCompleteness({
        mode: 'strict',
        events,
        docExists: () => false,
      });
      expect(result.verdict).toBe('block');
      expect(result.missingDocs).toHaveLength(1);
    });

    it('is ok in strict when every event doc exists', () => {
      const result = evaluateAnalyticsCompleteness({
        mode: 'strict',
        events,
        docExists: () => true,
      });
      expect(result).toEqual({ mode: 'strict', verdict: 'ok', missingDocs: [] });
    });
  });

  describe('resolveAnalyticsStrictness + forProject', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-analytics-enf-'));
      mkdirSync(join(root, '.paqad'), { recursive: true });
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('defaults to warn', () => {
      expect(resolveAnalyticsStrictness(root, {})).toBe('warn');
    });

    it('a local override may raise strictness to strict', () => {
      writeFileSync(join(root, '.paqad', '.config'), 'analytics_strictness=strict\n');
      expect(resolveAnalyticsStrictness(root, {})).toBe('strict');
    });

    it('checks docs on the real filesystem for a project', () => {
      writeFileSync(join(root, '.paqad', '.config'), 'analytics_strictness=strict\n');
      const missing = evaluateAnalyticsCompletenessForProject(root, events, {});
      expect(missing.verdict).toBe('block');

      mkdirSync(join(root, 'docs', 'modules', 'checkout', 'analytics', 'cart'), {
        recursive: true,
      });
      writeFileSync(
        join(root, 'docs', 'modules', 'checkout', 'analytics', 'cart', 'checkout-started.md'),
        '# Event',
      );
      const present = evaluateAnalyticsCompletenessForProject(root, events, {});
      expect(present.verdict).toBe('ok');
    });
  });
});
