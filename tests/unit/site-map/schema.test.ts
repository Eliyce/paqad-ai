import { describe, expect, it } from 'vitest';

import { isAppMap, isJourney, validateAppMap, validateJourney } from '@/site-map/index.js';
import {
  APP_KINDS,
  CONFIDENCES,
  DERIVATIONS,
  FLAG_LIFECYCLES,
  GUARD_KINDS,
  GUARD_MODES,
  JOURNEY_STATUSES,
  SITE_MAP_SCHEMA_VERSION,
  SURFACE_KINDS,
  VISIBILITIES,
} from '@/core/types/site-map.js';
import {
  minimalAppMap,
  minimalJourney,
  validAppMap,
  validJourney,
} from '../../fixtures/site-map/valid-app-map.js';

describe('site-map vocabulary', () => {
  it('pins schema version 1 and exposes the closed vocabularies', () => {
    expect(SITE_MAP_SCHEMA_VERSION).toBe(1);
    expect(APP_KINDS).toContain('llm-workflows');
    expect(SURFACE_KINDS).toContain('router');
    expect(SURFACE_KINDS).toContain('decision-pause');
    expect(GUARD_KINDS).toContain('feature-flag');
    expect(GUARD_MODES).toEqual(['deterministic', 'llm-judged']);
    expect(VISIBILITIES).toEqual(['frontstage', 'backstage']);
    expect(DERIVATIONS).toContain('human');
    expect(CONFIDENCES).toContain('low');
    expect(FLAG_LIFECYCLES).toContain('stale');
    expect(JOURNEY_STATUSES).toEqual(['proposed', 'confirmed', 'locked']);
  });
});

describe('validateAppMap', () => {
  it('accepts a comprehensive, well-formed map', () => {
    const result = validateAppMap(validAppMap());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a minimal map with only the required fields', () => {
    expect(validateAppMap(minimalAppMap()).valid).toBe(true);
  });

  it('rejects a wrong schema_version', () => {
    const result = validateAppMap({ ...minimalAppMap(), schema_version: 99 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing required top-level field', () => {
    const map = minimalAppMap() as Record<string, unknown>;
    delete map.surfaces;
    const result = validateAppMap(map);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('surfaces');
  });

  it('rejects an unknown property (typo guard)', () => {
    const map = { ...minimalAppMap(), surfaсes: [] } as Record<string, unknown>; // cyrillic с typo
    const result = validateAppMap(map);
    expect(result.valid).toBe(false);
  });

  it('rejects an unknown surface kind', () => {
    const map = minimalAppMap();
    (map.surfaces[0] as { kind: string }).kind = 'teleporter';
    const result = validateAppMap(map);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('/surfaces/0/kind');
  });

  it('rejects an unknown guard kind', () => {
    const map = validAppMap();
    (map.guards![0] as { kind: string }).kind = 'vibes';
    expect(validateAppMap(map).valid).toBe(false);
  });

  it('rejects a non-object at the root', () => {
    const result = validateAppMap('not a map');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('/');
  });

  it('isAppMap narrows a valid value and rejects an invalid one', () => {
    expect(isAppMap(validAppMap())).toBe(true);
    expect(isAppMap({ schema_version: 1 })).toBe(false);
  });
});

describe('validateJourney', () => {
  it('accepts a comprehensive, well-formed journey', () => {
    const result = validateJourney(validJourney());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a minimal journey with only the required fields', () => {
    expect(validateJourney(minimalJourney()).valid).toBe(true);
  });

  it('rejects a missing required field', () => {
    const journey = minimalJourney() as Record<string, unknown>;
    delete journey.goal;
    const result = validateJourney(journey);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('goal');
  });

  it('rejects an unknown journey status', () => {
    const journey = { ...minimalJourney(), status: 'maybe' };
    expect(validateJourney(journey).valid).toBe(false);
  });

  it('rejects a step without a surface', () => {
    const journey = minimalJourney();
    (journey.steps[0] as Record<string, unknown>) = { action: 'do a thing' };
    const result = validateJourney(journey);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('surface');
  });

  it('isJourney narrows a valid value and rejects an invalid one', () => {
    expect(isJourney(validJourney())).toBe(true);
    expect(isJourney({ schema_version: 1 })).toBe(false);
  });
});
