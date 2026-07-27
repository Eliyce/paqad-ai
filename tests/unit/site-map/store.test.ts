import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SiteMapSchemaError,
  appMapPath,
  journeyPath,
  journeysDir,
  listJourneyIds,
  readAllJourneys,
  readAppMap,
  readJourney,
  writeAppMap,
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
});
