import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SiteMapSchemaError,
  appMapPath,
  canonicalAppMapPath,
  canonicalJourneysDir,
  findLatestSiteMapSidecar,
  journeyPath,
  journeysDir,
  listJourneyIds,
  readAllCanonicalJourneys,
  readAllJourneys,
  readAppMap,
  readCanonicalSiteMap,
  readJourney,
  readSiteMapSidecar,
  writeAppMap,
  writeJourney,
} from '@/site-map/index.js';
import { PATHS } from '@/core/constants/paths.js';
import type { AppMap, Journey } from '@/core/types/site-map.js';

import {
  minimalJourney,
  validAppMap,
  validJourney,
} from '../../fixtures/site-map/valid-app-map.js';

describe('site-map store', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-store-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('app-map', () => {
    it('round-trips a valid map through YAML', () => {
      const map = validAppMap();
      const path = writeAppMap(root, map);
      expect(path).toBe(appMapPath(root));
      expect(readAppMap(root)).toEqual(map);
    });

    it('leaves no temp file behind after an atomic write', () => {
      writeAppMap(root, validAppMap());
      expect(() => readFileSync(`${appMapPath(root)}.tmp`, 'utf8')).toThrow();
    });

    it('throws SiteMapSchemaError rather than persisting an invalid map', () => {
      const bad = { ...validAppMap(), schema_version: 99 } as unknown as AppMap;
      expect(() => writeAppMap(root, bad)).toThrow(SiteMapSchemaError);
      // Nothing was written.
      expect(readAppMap(root)).toBeNull();
      try {
        writeAppMap(root, bad);
      } catch (error) {
        expect(error).toBeInstanceOf(SiteMapSchemaError);
        expect((error as SiteMapSchemaError).errors.length).toBeGreaterThan(0);
      }
    });

    it('reads null when the map is absent', () => {
      expect(readAppMap(root)).toBeNull();
    });

    it('reads null when the file is corrupt YAML', () => {
      const target = appMapPath(root);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, ':\n  - [unbalanced', 'utf8');
      expect(readAppMap(root)).toBeNull();
    });

    it('reads null when the file is valid YAML but schema-invalid', () => {
      const target = appMapPath(root);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, 'schema_version: 1\napp:\n  name: x\n', 'utf8'); // no surfaces
      expect(readAppMap(root)).toBeNull();
    });
  });

  describe('journeys', () => {
    it('round-trips a valid journey through YAML', () => {
      const journey = validJourney();
      const path = writeJourney(root, journey);
      expect(path).toBe(journeyPath(root, journey.id));
      expect(readJourney(root, journey.id)).toEqual(journey);
    });

    it('throws SiteMapSchemaError rather than persisting an invalid journey', () => {
      const bad = { ...minimalJourney(), status: 'nope' } as unknown as Journey;
      expect(() => writeJourney(root, bad)).toThrow(/failed schema validation/);
      expect(readJourney(root, bad.id)).toBeNull();
    });

    it('reads null for an absent or schema-invalid journey', () => {
      expect(readJourney(root, 'missing')).toBeNull();
      const target = journeyPath(root, 'broken');
      mkdirSync(journeysDir(root), { recursive: true });
      writeFileSync(target, 'schema_version: 1\nid: broken\n', 'utf8'); // missing required fields
      expect(readJourney(root, 'broken')).toBeNull();
    });

    it('lists journey ids, ignoring non-journey files, sorted', () => {
      writeJourney(root, { ...validJourney(), id: 'zeta' });
      writeJourney(root, { ...minimalJourney(), id: 'alpha' });
      writeFileSync(join(journeysDir(root), 'notes.md'), 'ignore me', 'utf8');
      expect(listJourneyIds(root)).toEqual(['alpha', 'zeta']);
    });

    it('lists nothing when the journeys directory is absent', () => {
      expect(listJourneyIds(root)).toEqual([]);
    });

    it('reads all valid journeys and skips invalid ones', () => {
      writeJourney(root, { ...validJourney(), id: 'a' });
      writeJourney(root, { ...minimalJourney(), id: 'b' });
      // Drop a schema-invalid file directly into the dir; it must be skipped, not crash.
      writeFileSync(
        join(journeysDir(root), `c${''}.journey.yaml`),
        'schema_version: 1\nid: c\n',
        'utf8',
      );
      const ids = readAllJourneys(root).map((journey) => journey.id);
      expect(ids).toEqual(['a', 'b']);
    });
  });

  describe('canonical map (issue #466)', () => {
    function writeCanonicalYaml(path: string, data: unknown): void {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, YAML.stringify(data), 'utf8');
    }

    it('reads the canonical app-map from docs/site-map/, and null when absent or invalid', () => {
      expect(readCanonicalSiteMap(root)).toBeNull();

      const map = validAppMap();
      writeCanonicalYaml(canonicalAppMapPath(root), map);
      expect(readCanonicalSiteMap(root)).toEqual(map);

      // Valid YAML, invalid shape → absent, never a half-map masquerading as real.
      writeCanonicalYaml(canonicalAppMapPath(root), { schema_version: 1, app: { name: 'x' } });
      expect(readCanonicalSiteMap(root)).toBeNull();
    });

    it('accepts trust tiers on the canonical map elements', () => {
      const map = validAppMap();
      map.surfaces[0]!.trust = 'proven-in-code';
      map.surfaces[0]!.transitions![0]!.trust = 'proven-by-test';
      map.guards![0]!.trust = 'human-confirmed';
      map.journeys![0]!.trust = 'inferred';
      writeCanonicalYaml(canonicalAppMapPath(root), map);
      expect(readCanonicalSiteMap(root)).toEqual(map);
    });

    it('reads every valid canonical journey, skips invalid, and returns [] when absent', () => {
      expect(readAllCanonicalJourneys(root)).toEqual([]);

      const dir = canonicalJourneysDir(root);
      writeCanonicalYaml(join(dir, 'checkout.journey.yaml'), { ...validJourney(), id: 'checkout' });
      writeCanonicalYaml(join(dir, 'onboard.journey.yaml'), { ...minimalJourney(), id: 'onboard' });
      // A schema-invalid file must be skipped, not crash the read.
      writeFileSync(join(dir, 'broken.journey.yaml'), 'schema_version: 1\nid: broken\n', 'utf8');

      expect(readAllCanonicalJourneys(root).map((journey) => journey.id)).toEqual([
        'checkout',
        'onboard',
      ]);
    });
  });

  describe('run-report sidecar', () => {
    function writeSidecar(name: string, body: string): string {
      const dir = join(root, PATHS.SITE_MAP_REPORT_DIR);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, name);
      writeFileSync(path, body, 'utf8');
      return path;
    }

    it('reads a valid sidecar and returns null for missing / corrupt / non-array findings', () => {
      const valid = writeSidecar(
        '2026-01-02.json',
        JSON.stringify({ report_id: 'X', findings: [] }),
      );
      expect(readSiteMapSidecar(valid)?.report_id).toBe('X');

      expect(readSiteMapSidecar(join(root, 'docs/site-map/absent.json'))).toBeNull();

      const corrupt = writeSidecar('corrupt.json', '{ not json');
      expect(readSiteMapSidecar(corrupt)).toBeNull();

      const noFindings = writeSidecar('no-findings.json', JSON.stringify({ report_id: 'X' }));
      expect(readSiteMapSidecar(noFindings)).toBeNull();
    });

    it('finds the newest sidecar, excludes retest reports, and returns null when the dir is absent', () => {
      expect(findLatestSiteMapSidecar(root)).toBeNull();

      // A dir that exists but holds only a retest sidecar has no eligible source → null.
      writeSidecar('2026-01-01-00-00-00-retest-2026-03-01-00-00-00.json', '{}');
      expect(findLatestSiteMapSidecar(root)).toBeNull();

      writeSidecar('2026-01-01-00-00-00.json', '{}');
      writeSidecar('2026-02-01-00-00-00.json', '{}');

      expect(findLatestSiteMapSidecar(root)).toBe(
        join(root, PATHS.SITE_MAP_REPORT_DIR, '2026-02-01-00-00-00.json'),
      );
    });
  });
});
