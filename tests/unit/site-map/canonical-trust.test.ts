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

  it('stamps the earned tier into the stored map and reports the written path', () => {
    writeCanonicalSiteMap(root, mapWith({ evidence: [{ file: 'a.ts', line: 1 }] }));

    const result = restampCanonicalTrust(root, resolveAll);

    expect(result).toEqual({ status: 'stamped', path: canonicalAppMapPath(root) });
    // The stored map now carries the proven-in-code its resolving anchor earned, so the dashboard
    // reads it statically.
    const stored = readFileSync(canonicalAppMapPath(root), 'utf8');
    expect(stored).toContain('trust: proven-in-code');
  });

  it('leaves an already-earned map byte-for-byte untouched', () => {
    // No evidence anywhere → nothing can be earned or changed.
    writeCanonicalSiteMap(root, mapWith());
    const before = readFileSync(canonicalAppMapPath(root), 'utf8');

    const resolve = vi.fn(resolveAll);
    expect(restampCanonicalTrust(root, resolve)).toEqual({ status: 'unchanged' });

    // It still read and resolved (proving it checked), but wrote nothing.
    expect(resolve).toHaveBeenCalledOnce();
    expect(readFileSync(canonicalAppMapPath(root), 'utf8')).toBe(before);
  });
});
