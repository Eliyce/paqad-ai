import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalAppMapPath,
  restampCanonicalTrust,
  writeCanonicalSiteMap,
} from '@/site-map/index.js';
import type { AppMap, Evidence } from '@/core/types/site-map.js';
import type { EvidenceResolution } from '@/site-map/verification.js';

/** A resolver that marks every pointer resolved — the "all evidence is live" world. */
const resolveAll = (pointers: Evidence[]): EvidenceResolution[] =>
  pointers.map((pointer) => ({ file: pointer.file, line: pointer.line, status: 'resolved' }));

/** A resolver that marks every pointer's file gone — the "code the map cites moved" world. */
const resolveBroken = (pointers: Evidence[]): EvidenceResolution[] =>
  pointers.map((pointer) => ({ file: pointer.file, line: pointer.line, status: 'file-missing' }));

function mapWith(surfaceOverrides: Partial<AppMap['surfaces'][number]> = {}): AppMap {
  return {
    schema_version: 1,
    app: { name: 'x', kind: 'cli' },
    surfaces: [{ id: 's', kind: 'page', label: 'S', ...surfaceOverrides }],
  };
}

describe('restampCanonicalTrust', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-restamp-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports no-map and never resolves anything when no canonical map exists', () => {
    const resolve = vi.fn(resolveAll);
    expect(restampCanonicalTrust(root, resolve)).toEqual({ status: 'no-map' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('stamps the earned tier AND the freshness into the stored map and reports the written path', () => {
    writeCanonicalSiteMap(root, mapWith({ evidence: [{ file: 'a.ts', line: 1 }] }));

    const result = restampCanonicalTrust(root, resolveAll);

    expect(result).toEqual({ status: 'stamped', path: canonicalAppMapPath(root) });
    // The stored map now carries the proven-in-code its resolving anchor earned and the freshness
    // its one live anchor proves, so the dashboard reads both statically.
    const stored = readFileSync(canonicalAppMapPath(root), 'utf8');
    expect(stored).toContain('trust: proven-in-code');
    expect(stored).toContain('anchors_total: 1');
    expect(stored).toContain('anchors_resolved: 1');
    expect(stored).toContain('anchors_broken: 0');
  });

  it('stamps freshness even when no trust tier changed, then is a byte-for-byte no-op', () => {
    // No evidence anywhere → no tier can be earned, but the map still gains its {0,0,0} freshness.
    writeCanonicalSiteMap(root, mapWith());

    const first = vi.fn(resolveAll);
    expect(restampCanonicalTrust(root, first)).toEqual({
      status: 'stamped',
      path: canonicalAppMapPath(root),
    });
    expect(first).toHaveBeenCalledOnce();
    const afterStamp = readFileSync(canonicalAppMapPath(root), 'utf8');
    expect(afterStamp).toContain('anchors_total: 0');

    // Re-stamping the already-stamped map over the same code reads and resolves again (proving it
    // checked), but writes nothing.
    const second = vi.fn(resolveAll);
    expect(restampCanonicalTrust(root, second)).toEqual({ status: 'unchanged' });
    expect(second).toHaveBeenCalledOnce();
    expect(readFileSync(canonicalAppMapPath(root), 'utf8')).toBe(afterStamp);
  });

  it('records a broken anchor as staleness when the cited code has moved', () => {
    writeCanonicalSiteMap(root, mapWith({ evidence: [{ file: 'gone.ts', line: 9 }] }));

    expect(restampCanonicalTrust(root, resolveBroken)).toEqual({
      status: 'stamped',
      path: canonicalAppMapPath(root),
    });
    const stored = readFileSync(canonicalAppMapPath(root), 'utf8');
    // A broken anchor collapses the tier to unverified (dropped from the map) and shows as stale.
    expect(stored).not.toContain('trust:');
    expect(stored).toContain('anchors_total: 1');
    expect(stored).toContain('anchors_resolved: 0');
    expect(stored).toContain('anchors_broken: 1');
  });
});
