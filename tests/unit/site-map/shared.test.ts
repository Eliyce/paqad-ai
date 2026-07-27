import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assignSiteMapFindingIds,
  findingFingerprint,
  sortFindings,
  toSiteMapReportId,
  toSiteMapTimestamp,
  writeJsonFile,
} from '@/site-map/shared.js';
import type { SiteMapFinding } from '@/core/types/site-map-run.js';

function finding(overrides: Partial<SiteMapFinding> = {}): SiteMapFinding {
  return {
    id: '',
    title: 'Orphan surface',
    description: 'not reachable',
    category: 'SM-ORPHAN',
    severity: 'medium',
    tier: 'deterministic',
    confidence: 1,
    evidence: ['surface:admin.audit'],
    resolution: 'Add a transition into it or remove it',
    affected_surfaces: ['admin.audit'],
    affected_files: ['routes/web.php'],
    baseline_status: 'unknown',
    status: 'open',
    ...overrides,
  };
}

describe('site-map shared', () => {
  describe('timestamps', () => {
    it('formats a local-time run id for each prefix', () => {
      const date = new Date(2026, 6, 27, 9, 8, 7);
      expect(toSiteMapTimestamp(date)).toBe('2026-07-27-09-08-07');
      expect(toSiteMapReportId('SITEMAP', date)).toBe('SITEMAP-2026-07-27-09-08-07');
      expect(toSiteMapReportId('RETEST', date)).toBe('RETEST-2026-07-27-09-08-07');
    });
  });

  describe('writeJsonFile', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-shared-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('writes pretty JSON with a trailing newline, creating parent dirs', async () => {
      const target = join(root, 'nested', 'out.json');
      await writeJsonFile(target, { a: 1 });
      const text = readFileSync(target, 'utf8');
      expect(text).toBe('{\n  "a": 1\n}\n');
    });
  });

  describe('findingFingerprint', () => {
    it('is stable regardless of affected-list order', () => {
      const a = finding({ affected_surfaces: ['x', 'y'], affected_files: ['b', 'a'] });
      const b = finding({ affected_surfaces: ['y', 'x'], affected_files: ['a', 'b'] });
      expect(findingFingerprint(a)).toBe(findingFingerprint(b));
    });

    it('changes when the meaning changes', () => {
      expect(findingFingerprint(finding())).not.toBe(
        findingFingerprint(finding({ category: 'SM-DEADEND' })),
      );
    });
  });

  describe('assignSiteMapFindingIds', () => {
    it('assigns stable SM- ids and suffixes collisions', () => {
      const [first, second] = assignSiteMapFindingIds([finding(), finding()]);
      expect(first!.id).toMatch(/^SM-[0-9A-F]{8}$/);
      expect(second!.id).toBe(`${first!.id}-02`);
    });

    it('gives distinct findings distinct ids', () => {
      const [a, b] = assignSiteMapFindingIds([finding(), finding({ category: 'SM-XREF' })]);
      expect(a!.id).not.toBe(b!.id);
    });
  });

  describe('sortFindings', () => {
    it('orders most-severe first, breaking ties by id', () => {
      const findings: SiteMapFinding[] = [
        finding({ id: 'SM-B', severity: 'low' }),
        finding({ id: 'SM-C', severity: 'high' }),
        finding({ id: 'SM-A', severity: 'high' }),
      ];
      expect(sortFindings(findings).map((f) => f.id)).toEqual(['SM-A', 'SM-C', 'SM-B']);
    });
  });
});
