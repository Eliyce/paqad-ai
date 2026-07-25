import { describe, expect, it } from 'vitest';

import { nearestFrameworkSymbol, queryFrameworkApi } from '@/framework-api/query.js';
import {
  FRAMEWORK_API_SCHEMA_VERSION,
  type FrameworkApiIndex,
  type FrameworkApiSymbol,
} from '@/framework-api/types.js';

function symbol(overrides: Partial<FrameworkApiSymbol> & { name: string }): FrameworkApiSymbol {
  return {
    kind: 'function',
    exists: true,
    deprecated: false,
    message: null,
    since: null,
    for_removal: false,
    provenance: 'asserted',
    ...overrides,
  };
}

function indexWith(symbols: FrameworkApiSymbol[]): FrameworkApiIndex {
  return {
    schema_version: FRAMEWORK_API_SCHEMA_VERSION,
    header: { generated_at: '2026-01-01T00:00:00.000Z', schema_version: 1 },
    packages: [
      {
        package: 'react',
        version: '19.2.6',
        ecosystem: 'node',
        root: '.',
        content_hash: 'sha256:abc',
        sources: [],
        symbols,
      },
    ],
    blocked: [],
  };
}

describe('queryFrameworkApi', () => {
  it('reports a resolved, untagged symbol as live', () => {
    const result = queryFrameworkApi(indexWith([symbol({ name: 'useId' })]), 'react', 'useId');
    expect(result.verdict).toBe('live');
    expect(result.version).toBe('19.2.6');
    expect(result.nearest).toBeNull();
  });

  it('reports a tagged symbol as deprecated and carries its record (AC-4)', () => {
    const record = symbol({
      name: 'LegacyRef',
      deprecated: true,
      message: 'Use Ref instead.',
      since: '18.0',
      for_removal: true,
    });
    const result = queryFrameworkApi(indexWith([record]), 'react', 'LegacyRef');
    expect(result.verdict).toBe('deprecated');
    expect(result.record?.message).toBe('Use Ref instead.');
    expect(result.record?.since).toBe('18.0');
  });

  it('reports an unlisted symbol as absent with the nearest match (AC-3)', () => {
    const result = queryFrameworkApi(indexWith([symbol({ name: 'useId' })]), 'react', 'useIdd');
    expect(result.verdict).toBe('absent');
    expect(result.nearest).toBe('useId');
  });

  it('offers no suggestion when nothing is close', () => {
    const result = queryFrameworkApi(
      indexWith([symbol({ name: 'useId' })]),
      'react',
      'somethingEntirelyUnrelated',
    );
    expect(result.verdict).toBe('absent');
    expect(result.nearest).toBeNull();
  });

  it('matches a member by its last segment, so either phrasing reaches one verdict', () => {
    const record = symbol({
      name: 'Component.componentWillMount',
      kind: 'member',
      deprecated: true,
      message: 'use componentDidMount.',
    });
    expect(queryFrameworkApi(indexWith([record]), 'react', 'componentWillMount').verdict).toBe(
      'deprecated',
    );
    expect(
      queryFrameworkApi(indexWith([record]), 'react', 'Component.componentWillMount').verdict,
    ).toBe('deprecated');
  });

  it('never calls a member of a wildcard container absent (AC-5, INV-2)', () => {
    const result = queryFrameworkApi(
      indexWith([symbol({ name: 'Component.*', kind: 'member', provenance: 'unknown-dynamic' })]),
      'react',
      'Component.render',
    );
    expect(result.verdict).toBe('unknown-dynamic');
    expect(result.record).toBeNull();
  });

  it('reports a record whose own provenance is dynamic as unknown-dynamic', () => {
    const result = queryFrameworkApi(
      indexWith([symbol({ name: 'Facade.*', kind: 'member', provenance: 'unknown-dynamic' })]),
      'react',
      'Facade.*',
    );
    expect(result.verdict).toBe('unknown-dynamic');
  });

  it('does not let a wildcard satisfy a bare symbol lookup', () => {
    const result = queryFrameworkApi(
      indexWith([symbol({ name: 'Component.*', kind: 'member', provenance: 'unknown-dynamic' })]),
      'react',
      'render',
    );
    expect(result.verdict).toBe('absent');
  });

  it('excludes wildcards from the nearest-match candidates', () => {
    const result = queryFrameworkApi(
      indexWith([
        symbol({ name: 'useId' }),
        symbol({ name: 'useI.*', kind: 'member', provenance: 'unknown-dynamic' }),
      ]),
      'react',
      'useIdd',
    );
    expect(result.nearest).toBe('useId');
  });

  it('reports a package the index does not cover, without guessing', () => {
    const result = queryFrameworkApi(indexWith([symbol({ name: 'useId' })]), 'vue', 'ref');
    expect(result.verdict).toBe('package-not-indexed');
    expect(result.version).toBeNull();
    expect(result.nearest).toBeNull();
  });
});

describe('nearestFrameworkSymbol', () => {
  it('matches on the last segment so a member suggestion is meaningful', () => {
    expect(nearestFrameworkSymbol('componentWillMont', ['Component.componentWillMount'])).toBe(
      'Component.componentWillMount',
    );
  });

  it('returns null against an empty candidate set', () => {
    expect(nearestFrameworkSymbol('useId', [])).toBeNull();
  });

  it('picks the closest of several candidates', () => {
    expect(nearestFrameworkSymbol('useStat', ['useState', 'useEffect', 'useMemo'])).toBe(
      'useState',
    );
  });

  it('keeps a short name from matching an unrelated short name', () => {
    expect(nearestFrameworkSymbol('ref', ['zzzzzzzzzz'])).toBeNull();
  });
});
