import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SiteMapSchemaError,
  canonicalAppMapPath,
  journeyPath,
  journeysDir,
  listJourneyIds,
  readAllJourneys,
  readCanonicalSiteMap,
  readJourney,
  writeCanonicalSiteMap,
  writeJourney,
} from '@/site-map/index.js';
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

  describe('canonical app-map (docs/site-map/)', () => {
    it('round-trips a valid map through YAML at the one canonical location', () => {
      const map = validAppMap();
      const path = writeCanonicalSiteMap(root, map);
      expect(path).toBe(canonicalAppMapPath(root));
      expect(path).toContain(join('docs', 'site-map', 'app-map.yaml'));
      expect(readCanonicalSiteMap(root)).toEqual(map);
    });

    it('leaves no temp file behind after an atomic write', () => {
      writeCanonicalSiteMap(root, validAppMap());
      expect(() => readFileSync(`${canonicalAppMapPath(root)}.tmp`, 'utf8')).toThrow();
    });

    it('throws SiteMapSchemaError rather than persisting an invalid map', () => {
      const bad = { ...validAppMap(), schema_version: 99 } as unknown as AppMap;
      expect(() => writeCanonicalSiteMap(root, bad)).toThrow(SiteMapSchemaError);
      // Nothing was written.
      expect(readCanonicalSiteMap(root)).toBeNull();
      try {
        writeCanonicalSiteMap(root, bad);
      } catch (error) {
        expect(error).toBeInstanceOf(SiteMapSchemaError);
        expect((error as SiteMapSchemaError).errors.length).toBeGreaterThan(0);
      }
    });

    it('reads null when the map is absent', () => {
      expect(readCanonicalSiteMap(root)).toBeNull();
    });

    it('reads null when the file is corrupt YAML', () => {
      const target = canonicalAppMapPath(root);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, ':\n  - [unbalanced', 'utf8');
      expect(readCanonicalSiteMap(root)).toBeNull();
    });

    it('reads null when the file is valid YAML but schema-invalid', () => {
      const target = canonicalAppMapPath(root);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, 'schema_version: 1\napp:\n  name: x\n', 'utf8'); // no surfaces
      expect(readCanonicalSiteMap(root)).toBeNull();
    });

    it('accepts trust tiers on the canonical map elements', () => {
      const map = validAppMap();
      map.surfaces[0]!.trust = 'proven-in-code';
      map.surfaces[0]!.transitions![0]!.trust = 'proven-by-test';
      map.guards![0]!.trust = 'human-confirmed';
      map.journeys![0]!.trust = 'inferred';
      const target = canonicalAppMapPath(root);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, YAML.stringify(map), 'utf8');
      expect(readCanonicalSiteMap(root)).toEqual(map);
    });
  });

  describe('journeys (docs/site-map/journeys/)', () => {
    it('round-trips a valid journey through YAML under the canonical location', () => {
      const journey = validJourney();
      const path = writeJourney(root, journey);
      expect(path).toBe(journeyPath(root, journey.id));
      expect(path).toContain(join('docs', 'site-map', 'journeys'));
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
      expect(readAllJourneys(root)).toEqual([]);
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
});
