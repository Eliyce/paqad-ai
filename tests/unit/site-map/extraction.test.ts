import { describe, expect, it } from 'vitest';

import {
  SITE_MAP_EXTRACTION_SCHEMA_VERSION,
  assembleExtraction,
  blockedExtractor,
  extractGenericSurfaces,
  extractNodeCliSurfaces,
  extractionFingerprint,
  sortExtractedSurfaces,
  type ExtractedSurface,
  type ExtractorOutput,
} from '@/site-map/extraction.js';

function surface(overrides: Partial<ExtractedSurface> = {}): ExtractedSurface {
  return {
    raw_id: 'node-cli-x',
    kind: 'cli-command',
    label: 'X',
    evidence: [{ file: 'src/cli/x.ts', line: 1 }],
    derivation: 'static',
    confidence: 'high',
    source: 'node-cli',
    ...overrides,
  };
}

describe('site-map extraction', () => {
  describe('extractNodeCliSurfaces', () => {
    it('maps each non-hidden command to a cli-command surface with a bin entry', () => {
      const [only] = extractNodeCliSurfaces([
        {
          name: 'plan compile',
          description: 'Compile the plan',
          file: 'src/cli/plan.ts',
          line: 42,
        },
      ]);
      expect(only).toEqual({
        raw_id: 'node-cli-plan-compile',
        kind: 'cli-command',
        label: 'Compile the plan',
        evidence: [{ file: 'src/cli/plan.ts', line: 42 }],
        entry: { kind: 'bin', value: 'plan compile' },
        derivation: 'static',
        confidence: 'high',
        source: 'node-cli',
      });
    });

    it('skips hidden commands', () => {
      expect(
        extractNodeCliSurfaces([{ name: 'internal', file: 'src/cli/x.ts', hidden: true }]),
      ).toEqual([]);
    });

    it('falls back to the command name when the description is missing or blank', () => {
      const [noDesc] = extractNodeCliSurfaces([{ name: 'sitemap', file: 'src/cli/x.ts' }]);
      const [blankDesc] = extractNodeCliSurfaces([
        { name: 'health', description: '   ', file: 'src/cli/x.ts' },
      ]);
      expect(noDesc!.label).toBe('sitemap');
      expect(blankDesc!.label).toBe('health');
    });

    it('omits the line from evidence when the gatherer could not pin one', () => {
      const [only] = extractNodeCliSurfaces([{ name: 'audit', file: 'src/cli/audit.ts' }]);
      expect(only!.evidence).toEqual([{ file: 'src/cli/audit.ts' }]);
    });
  });

  describe('extractGenericSurfaces', () => {
    it('trusts the record kind, carries the entry, and flags medium confidence', () => {
      const [only] = extractGenericSurfaces([
        {
          kind: 'page',
          identifier: '/users/:id',
          label: 'User detail',
          file: 'app/routes/users.tsx',
          line: 7,
          entry: { kind: 'route', value: '/users/:id' },
        },
      ]);
      expect(only).toEqual({
        raw_id: 'generic-users-id',
        kind: 'page',
        label: 'User detail',
        evidence: [{ file: 'app/routes/users.tsx', line: 7 }],
        entry: { kind: 'route', value: '/users/:id' },
        derivation: 'static',
        confidence: 'medium',
        source: 'generic',
      });
    });

    it('falls back to the identifier as label and omits entry when absent', () => {
      const [blankLabel] = extractGenericSurfaces([
        { kind: 'api', identifier: 'GET /health', label: '  ', file: 'src/api.ts' },
      ]);
      expect(blankLabel!.label).toBe('GET /health');
      expect(blankLabel!.entry).toBeUndefined();
    });

    it('collapses to the bare source when the identifier has no word characters', () => {
      const [root] = extractGenericSurfaces([
        { kind: 'page', identifier: '/', file: 'app/root.tsx' },
      ]);
      expect(root!.raw_id).toBe('generic');
    });
  });

  describe('sortExtractedSurfaces', () => {
    it('orders by raw_id without mutating the input', () => {
      const input = [surface({ raw_id: 'node-cli-b' }), surface({ raw_id: 'node-cli-a' })];
      const sorted = sortExtractedSurfaces(input);
      expect(sorted.map((s) => s.raw_id)).toEqual(['node-cli-a', 'node-cli-b']);
      expect(input.map((s) => s.raw_id)).toEqual(['node-cli-b', 'node-cli-a']);
    });
  });

  describe('extractionFingerprint', () => {
    it('is order-independent over the surface set', () => {
      const a = surface({ raw_id: 'node-cli-a' });
      const b = surface({ raw_id: 'node-cli-b' });
      expect(extractionFingerprint([a, b])).toBe(extractionFingerprint([b, a]));
    });

    it('changes when the surface set changes', () => {
      const a = surface({ raw_id: 'node-cli-a' });
      const b = surface({ raw_id: 'node-cli-b' });
      expect(extractionFingerprint([a])).not.toBe(extractionFingerprint([a, b]));
    });
  });

  describe('blockedExtractor', () => {
    it('builds an unavailable output carrying the reason and install hint', () => {
      expect(blockedExtractor('rails-routes', 'ruby not installed', 'Install Ruby 3.x')).toEqual({
        extractor: 'rails-routes',
        available: false,
        surfaces: [],
        blocked: {
          check: 'rails-routes surface extraction',
          reason: 'ruby not installed',
          install_hint: 'Install Ruby 3.x',
        },
      });
    });
  });

  describe('assembleExtraction', () => {
    it('merges available surfaces, records blocked checks, and fingerprints the set', () => {
      const outputs: ExtractorOutput[] = [
        {
          extractor: 'node-cli',
          available: true,
          surfaces: [surface({ raw_id: 'node-cli-b' }), surface({ raw_id: 'node-cli-a' })],
        },
        blockedExtractor('rails-routes', 'ruby missing', 'Install Ruby'),
      ];
      const result = assembleExtraction(outputs, 'cli');
      expect(result.schema_version).toBe(SITE_MAP_EXTRACTION_SCHEMA_VERSION);
      expect(result.app_kind).toBe('cli');
      expect(result.surfaces.map((s) => s.raw_id)).toEqual(['node-cli-a', 'node-cli-b']);
      expect(result.blocked_checks).toHaveLength(1);
      expect(result.extractors_ran).toBe(1);
      expect(result.low_confidence_fallback).toBe(false);
      expect(result.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    });

    it('unions evidence for surfaces sharing a raw_id, dropping exact duplicates', () => {
      const shared = 'node-cli-x';
      const outputs: ExtractorOutput[] = [
        {
          extractor: 'a',
          available: true,
          surfaces: [surface({ raw_id: shared, evidence: [{ file: 'a.ts', line: 1 }] })],
        },
        {
          extractor: 'b',
          available: true,
          surfaces: [
            surface({
              raw_id: shared,
              evidence: [
                { file: 'a.ts', line: 1 },
                { file: 'b.ts', note: 'via nav' },
              ],
            }),
          ],
        },
      ];
      const result = assembleExtraction(outputs, 'web');
      expect(result.surfaces).toHaveLength(1);
      expect(result.surfaces[0]!.evidence).toEqual([
        { file: 'a.ts', line: 1 },
        { file: 'b.ts', note: 'via nav' },
      ]);
    });

    it('ignores an unavailable extractor that carries no blocked check', () => {
      const outputs: ExtractorOutput[] = [
        { extractor: 'stub', available: false, surfaces: [], blocked: null },
      ];
      const result = assembleExtraction(outputs, 'service');
      expect(result.blocked_checks).toEqual([]);
      expect(result.surfaces).toEqual([]);
    });

    it('flags a low-confidence fallback when no extractor ran', () => {
      const result = assembleExtraction([blockedExtractor('x', 'r', 'h')], 'api');
      expect(result.extractors_ran).toBe(0);
      expect(result.low_confidence_fallback).toBe(true);
      expect(result.surfaces).toEqual([]);
    });
  });
});
