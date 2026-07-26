import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyLaravelBackstop,
  loadLaravelDeprecations,
  majorOf,
  mergeDocDerived,
  parseUpgradeGuide,
  upgradeGuideCachePath,
} from '@/framework-api/laravel-upgrade-guide.js';
import type { FrameworkApiSymbol } from '@/framework-api/types.js';

let root: string;

/** A fetch that answers with `body`, and records how many times it was called. */
function fakeFetch(body: string, ok = true) {
  const impl = vi.fn(async () =>
    Promise.resolve({ ok, text: async () => Promise.resolve(body) } as Response),
  );
  return impl as unknown as typeof globalThis.fetch & { mock: { calls: unknown[] } };
}

/** Seed the on-disk cache with already-derived records. */
function seedCache(major: string, names: string[], fetchedAt: number): void {
  const path = upgradeGuideCachePath(root, major);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      fetched_at: fetchedAt,
      parser_version: 1,
      records: names.map((name) =>
        record({ name, deprecated: true, since: major, provenance: 'doc-derived' }),
      ),
    }),
  );
}

/** A guide whose one deprecation is `Blueprint::getPrefix`. */
const GUIDE = '### Database\n\nThe `Blueprint::getPrefix()` method is deprecated.\n';

function record(overrides: Partial<FrameworkApiSymbol> & { name: string }): FrameworkApiSymbol {
  return {
    kind: 'member',
    exists: true,
    deprecated: false,
    message: null,
    since: null,
    for_removal: false,
    provenance: 'asserted',
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-laravel-guide-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('majorOf', () => {
  it('reads the major version of an installed version string', () => {
    expect(majorOf('13.18.0')).toBe('13');
    expect(majorOf('v11.0.0')).toBe('11');
  });

  it('returns null for anything that does not start with a major, so nothing is built from it', () => {
    // The major reaches a URL and a cache filename, and the version behind it is read out
    // of a project's own vendor tree — so a traversal attempt must produce "no guide".
    expect(majorOf('nonsense')).toBeNull();
    expect(majorOf('../../etc/passwd')).toBeNull();
    expect(majorOf('')).toBeNull();
  });
});

describe('loadLaravelDeprecations', () => {
  it('fetches the version-pinned guide and caches what it derived', async () => {
    const fetchImpl = fakeFetch(GUIDE);
    const first = await loadLaravelDeprecations(root, '12.4.0', { fetchImpl, now: () => 1000 });
    expect(first?.map((entry) => entry.name)).toEqual(['Blueprint::getPrefix']);

    // The cache holds derived records only — never the fetched document.
    const cached = JSON.parse(readFileSync(upgradeGuideCachePath(root, '12'), 'utf8')) as {
      fetched_at: number;
      parser_version: number;
      records: { name: string; message: string }[];
    };
    expect(cached).toMatchObject({ fetched_at: 1000, parser_version: 1 });
    expect(JSON.stringify(cached)).not.toContain('### Database');
    expect(cached.records[0]?.message).toBe(
      'The Laravel 12.x upgrade guide lists this as deprecated.',
    );

    const second = await loadLaravelDeprecations(root, '12.4.0', { fetchImpl, now: () => 2000 });
    expect(second?.map((entry) => entry.name)).toEqual(['Blueprint::getPrefix']);
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });

  it('never persists a symbol name outside the shape it accepts', async () => {
    const hostile =
      '### Removed\n\nThe `Evil::../../x()` and `Fine::go()` methods have been removed.\n';
    const records = await loadLaravelDeprecations(root, '12.0.0', {
      fetchImpl: fakeFetch(hostile),
      now: () => 1000,
    });
    expect(records?.map((entry) => entry.name)).toEqual(['Fine::go']);
  });

  it('re-fetches once the cache is older than its max age', async () => {
    seedCache('13', ['Stale::method'], 0);
    const records = await loadLaravelDeprecations(root, '13.0.0', {
      fetchImpl: fakeFetch(GUIDE),
      now: () => 10_000,
      maxAgeMs: 5_000,
    });
    expect(records?.map((entry) => entry.name)).toEqual(['Blueprint::getPrefix']);
  });

  it('re-fetches a cache written by an older parser', async () => {
    const path = upgradeGuideCachePath(root, '13');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ fetched_at: 1000, parser_version: 0, records: [] }));
    const records = await loadLaravelDeprecations(root, '13.0.0', {
      fetchImpl: fakeFetch(GUIDE),
      now: () => 1000,
    });
    expect(records?.map((entry) => entry.name)).toEqual(['Blueprint::getPrefix']);
  });

  it('never touches the network when offline, but still uses a stale cache (FR-13)', async () => {
    seedCache('13', ['Stale::method'], 0);
    const fetchImpl = fakeFetch(GUIDE);
    const records = await loadLaravelDeprecations(root, '13.0.0', {
      fetchImpl,
      offline: true,
      now: () => 10_000,
      maxAgeMs: 1,
    });
    expect(records?.map((entry) => entry.name)).toEqual(['Stale::method']);
    expect(fetchImpl.mock.calls).toHaveLength(0);
  });

  it('returns a fresh offline cache without falling through', async () => {
    seedCache('13', ['Fresh::method'], 9_999);
    const records = await loadLaravelDeprecations(root, '13.0.0', {
      offline: true,
      now: () => 10_000,
    });
    expect(records?.map((entry) => entry.name)).toEqual(['Fresh::method']);
  });

  it('returns null offline with nothing cached', async () => {
    expect(await loadLaravelDeprecations(root, '13.0.0', { offline: true })).toBeNull();
  });

  it('returns null for a version with no readable major, without fetching', async () => {
    const fetchImpl = fakeFetch(GUIDE);
    expect(await loadLaravelDeprecations(root, '../../etc', { fetchImpl })).toBeNull();
    expect(fetchImpl.mock.calls).toHaveLength(0);
  });

  it('returns null when the request fails, rather than failing the build', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.reject(new Error('offline')),
    ) as unknown as typeof globalThis.fetch;
    expect(await loadLaravelDeprecations(root, '13.0.0', { fetchImpl })).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    expect(
      await loadLaravelDeprecations(root, '99.0.0', { fetchImpl: fakeFetch('Not Found', false) }),
    ).toBeNull();
  });

  it('ignores a corrupt cache file', async () => {
    const path = upgradeGuideCachePath(root, '13');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not json');
    expect(await loadLaravelDeprecations(root, '13.0.0', { offline: true })).toBeNull();
  });

  it('ignores a cache file with the wrong shape', async () => {
    const path = upgradeGuideCachePath(root, '13');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ records: 42, parser_version: 1 }));
    expect(await loadLaravelDeprecations(root, '13.0.0', { offline: true })).toBeNull();
  });
});

describe('parseUpgradeGuide', () => {
  it('reads symbols out of a section a heading declares deprecated', () => {
    const records = parseUpgradeGuide(
      `## Upgrading To 11.0
#### Deprecated Schema Methods

The following have been removed:

- \`Connection::getDoctrineSchemaManager()\`
- \`Builder::useNativeSchemaOperationsIfPossible()\`
`,
      '11.0.0',
    );
    expect(records.map((entry) => entry.name)).toEqual([
      'Connection::getDoctrineSchemaManager',
      'Builder::useNativeSchemaOperationsIfPossible',
    ]);
    expect(records[0]).toMatchObject({
      deprecated: true,
      since: '11',
      for_removal: true,
      provenance: 'doc-derived',
    });
  });

  it('reads a symbol a prose sentence deprecates under a neutral heading', () => {
    const records = parseUpgradeGuide(
      `### Database

The \`Blueprint::getPrefix()\` method is deprecated.
The \`Blueprint::keep()\` method is unaffected.
`,
      '12.0.0',
    );
    expect(records.map((entry) => entry.name)).toEqual(['Blueprint::getPrefix']);
    expect(records[0]?.for_removal).toBe(false);
    expect(records[0]?.message).toContain('Database');
  });

  it('strengthens an earlier deprecation when a later line says removed', () => {
    const records = parseUpgradeGuide(
      `### Cache

The \`Store::touch()\` method is deprecated.
The \`Store::touch()\` method has been removed.
`,
      '13.0.0',
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.for_removal).toBe(true);
  });

  it('finds nothing in a guide that names no symbols', () => {
    expect(parseUpgradeGuide('# Upgrade Guide\n\nNothing to do.\n', '13.0.0')).toEqual([]);
  });
});

describe('mergeDocDerived', () => {
  it('upgrades an untagged declaration the guide deprecates (AC-2)', () => {
    const merged = mergeDocDerived(
      [record({ name: 'Illuminate\\Support\\Str::of' })],
      [record({ name: 'Str::of', deprecated: true, since: '13', provenance: 'doc-derived' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: 'Illuminate\\Support\\Str::of',
      deprecated: true,
      provenance: 'doc-derived',
    });
  });

  it('never overwrites a real @deprecated tag read from the code', () => {
    const merged = mergeDocDerived(
      [
        record({
          name: 'Illuminate\\Support\\Str::of',
          deprecated: true,
          message: 'from the docblock.',
        }),
      ],
      [
        record({
          name: 'Str::of',
          deprecated: true,
          message: 'from the guide.',
          provenance: 'doc-derived',
        }),
      ],
    );
    expect(merged[0]).toMatchObject({ message: 'from the docblock.', provenance: 'asserted' });
  });

  it('leaves a wildcard container alone', () => {
    const merged = mergeDocDerived(
      [record({ name: 'Str.*', provenance: 'unknown-dynamic' })],
      [record({ name: 'Str', deprecated: true, provenance: 'doc-derived' })],
    );
    expect(merged[0]?.deprecated).toBe(false);
  });

  it('appends a symbol the declarations never saw', () => {
    const merged = mergeDocDerived(
      [record({ name: 'Illuminate\\Support\\Str' })],
      [record({ name: 'Gone::method', deprecated: true, provenance: 'doc-derived' })],
    );
    expect(merged.map((entry) => entry.name)).toEqual(['Illuminate\\Support\\Str', 'Gone::method']);
  });

  it('is idempotent, so a rebuild does not double-count', () => {
    const docDerived = [record({ name: 'Str::of', deprecated: true, provenance: 'doc-derived' })];
    const once = mergeDocDerived([record({ name: 'Illuminate\\Support\\Str::of' })], docDerived);
    expect(mergeDocDerived(once, docDerived)).toEqual(once);
  });
});

describe('applyLaravelBackstop', () => {
  const laravelIndex = () => ({
    packages: [
      {
        package: 'laravel/framework',
        version: '12.4.0',
        symbols: [record({ name: 'Illuminate\\Database\\Schema\\Blueprint::getPrefix' })],
      },
    ],
  });

  it('folds the guide into the laravel entry and reports what it added', async () => {
    const index = laravelIndex();
    const result = await applyLaravelBackstop(root, index, { fetchImpl: fakeFetch(GUIDE) });
    expect(result).toEqual({ applied: true, deprecations: 1 });
    expect(index.packages[0]?.symbols[0]).toMatchObject({
      deprecated: true,
      provenance: 'doc-derived',
    });
  });

  it('does nothing for a project with no laravel entry', async () => {
    expect(await applyLaravelBackstop(root, { packages: [] })).toEqual({
      applied: false,
      deprecations: 0,
    });
  });

  it('does nothing when the guide cannot be obtained', async () => {
    const index = laravelIndex();
    expect(await applyLaravelBackstop(root, index, { offline: true })).toEqual({
      applied: false,
      deprecations: 0,
    });
    expect(index.packages[0]?.symbols[0]?.deprecated).toBe(false);
  });
});
