import { describe, expect, it } from 'vitest';

import type { AppFreshness, AppMap } from '@/core/types/site-map.js';
import { deriveMapFreshness, isStale, stampMapFreshness } from '@/site-map/freshness.js';
import type { EvidenceResolution } from '@/site-map/verification.js';

/** A map with no cited evidence anywhere — nothing to age against code. */
function bareMap(): AppMap {
  return {
    schema_version: 1,
    app: { name: 'x', kind: 'cli' },
    surfaces: [{ id: 's', kind: 'page', label: 'S' }],
  };
}

/** A map that cites one anchor on a surface, one on its transition, and one on a guard. */
function citingMap(): AppMap {
  return {
    schema_version: 1,
    app: { name: 'x', kind: 'cli' },
    surfaces: [
      {
        id: 's',
        kind: 'page',
        label: 'S',
        evidence: { file: 'a.ts', line: 1 },
        transitions: [{ to: 't', trigger: 'go', evidence: { file: 'b.ts', line: 2 } }],
      },
      { id: 't', kind: 'page', label: 'T' },
    ],
    guards: [{ id: 'g', kind: 'role', label: 'G', evidence: { file: 'c.ts', line: 3 } }],
  };
}

describe('deriveMapFreshness', () => {
  it('reports zero anchors when the map cites no evidence', () => {
    expect(deriveMapFreshness(bareMap(), [])).toEqual({
      anchors_total: 0,
      anchors_resolved: 0,
      anchors_broken: 0,
    });
  });

  it('counts every distinct anchor as resolved when all cited code is live', () => {
    const resolutions: EvidenceResolution[] = [
      { file: 'a.ts', line: 1, status: 'resolved' },
      { file: 'b.ts', line: 2, status: 'resolved' },
      { file: 'c.ts', line: 3, status: 'resolved' },
    ];
    expect(deriveMapFreshness(citingMap(), resolutions)).toEqual({
      anchors_total: 3,
      anchors_resolved: 3,
      anchors_broken: 0,
    });
  });

  it('counts a missing file and a moved line as broken staleness', () => {
    const resolutions: EvidenceResolution[] = [
      { file: 'a.ts', line: 1, status: 'resolved' },
      { file: 'b.ts', line: 2, status: 'file-missing' },
      { file: 'c.ts', line: 3, status: 'line-missing' },
    ];
    expect(deriveMapFreshness(citingMap(), resolutions)).toEqual({
      anchors_total: 3,
      anchors_resolved: 1,
      anchors_broken: 2,
    });
  });

  it('treats an anchor the gatherer did not resolve as live, so it never inflates staleness', () => {
    // No resolutions supplied at all — buildStatusOf defaults each unlisted pointer to resolved.
    expect(deriveMapFreshness(citingMap(), [])).toEqual({
      anchors_total: 3,
      anchors_resolved: 3,
      anchors_broken: 0,
    });
  });
});

describe('stampMapFreshness', () => {
  const fresh: AppFreshness = { anchors_total: 2, anchors_resolved: 2, anchors_broken: 0 };

  it('stamps freshness into a map that has none, preserving the rest of app', () => {
    const map = bareMap();
    const { map: stamped, changed } = stampMapFreshness(map, fresh);
    expect(changed).toBe(true);
    expect(stamped.app.freshness).toEqual(fresh);
    expect(stamped.app.name).toBe('x');
    // The original is left untouched (a fresh copy is returned).
    expect(map.app.freshness).toBeUndefined();
  });

  it('is a no-op returning the same reference when the stored freshness already matches', () => {
    const map: AppMap = { ...bareMap(), app: { name: 'x', kind: 'cli', freshness: { ...fresh } } };
    const result = stampMapFreshness(map, { ...fresh });
    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
  });

  it('rewrites when the total differs', () => {
    const map: AppMap = { ...bareMap(), app: { name: 'x', kind: 'cli', freshness: { ...fresh } } };
    const result = stampMapFreshness(map, { ...fresh, anchors_total: 3 });
    expect(result.changed).toBe(true);
    expect(result.map.app.freshness?.anchors_total).toBe(3);
  });

  it('rewrites when the resolved count differs at the same total', () => {
    const map: AppMap = { ...bareMap(), app: { name: 'x', kind: 'cli', freshness: { ...fresh } } };
    const result = stampMapFreshness(map, { ...fresh, anchors_resolved: 1 });
    expect(result.changed).toBe(true);
  });

  it('rewrites when only the broken count differs', () => {
    const map: AppMap = { ...bareMap(), app: { name: 'x', kind: 'cli', freshness: { ...fresh } } };
    const result = stampMapFreshness(map, { ...fresh, anchors_broken: 1 });
    expect(result.changed).toBe(true);
  });
});

describe('isStale', () => {
  it('is stale exactly when at least one anchor is broken', () => {
    expect(isStale({ anchors_total: 3, anchors_resolved: 2, anchors_broken: 1 })).toBe(true);
    expect(isStale({ anchors_total: 3, anchors_resolved: 3, anchors_broken: 0 })).toBe(false);
  });
});
