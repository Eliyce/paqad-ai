// Real-resource test (RULE-11, RL-1dc7): load the ACTUAL installed @types/react and
// assert a non-empty, expected result, so a wrong resolution path fails loudly instead of
// returning an empty set that reads as "this package has no deprecations".
//
// This is the AC-2 case from issue #397, exercised against the declarations really on
// disk rather than a fixture: a legacy React class lifecycle must come back deprecated.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { nodeFrameworkApiAdapter } from '@/framework-api/adapters/node.js';
import { queryFrameworkApi } from '@/framework-api/query.js';
import { resolveInstalledVersion } from '@/framework-api/resolve-version.js';
import {
  FRAMEWORK_API_SCHEMA_VERSION,
  type FrameworkApiIndex,
  type FrameworkApiSymbol,
} from '@/framework-api/types.js';

// react is installed under the graph-ui sub-app in this repo, not at the root — which is
// exactly why the builder carries a per-package `root`.
const searchRoot = join(process.cwd(), 'graph-ui');
const installed = existsSync(searchRoot) ? resolveInstalledVersion(searchRoot, 'react') : null;

function indexFor(symbols: FrameworkApiSymbol[], version: string): FrameworkApiIndex {
  return {
    schema_version: FRAMEWORK_API_SCHEMA_VERSION,
    header: { generated_at: '2026-01-01T00:00:00.000Z', schema_version: 1 },
    packages: [
      {
        package: 'react',
        version,
        ecosystem: 'node',
        root: 'graph-ui',
        content_hash: 'sha256:test',
        sources: [],
        symbols,
      },
    ],
    blocked: [],
  };
}

// Skipped rather than failed when the sub-app's dependencies are not installed (a fresh
// clone without `pnpm run graph-ui:install`), because that is an environment gap, not a
// regression in this code.
describe.skipIf(installed === null)('framework-api against the real @types/react', () => {
  const version = installed?.version ?? '';
  const result = installed
    ? nodeFrameworkApiAdapter.index({
        projectRoot: process.cwd(),
        searchRoot,
        package: 'react',
        version,
        packageDir: installed.dir,
      })
    : null;

  it('resolves a real, non-empty API surface through @types/react', () => {
    expect(result?.indexed).toBe(true);
    if (!result?.indexed) return;
    expect(result.symbols.length).toBeGreaterThan(100);
    expect(result.sources[0]).toContain('@types/react');
  });

  it('resolves useId through `declare namespace React` + `export =` (INV-2)', () => {
    if (!result?.indexed) return;
    const query = queryFrameworkApi(indexFor(result.symbols, version), 'react', 'useId');
    expect(query.verdict).toBe('live');
  });

  it('marks a legacy class lifecycle deprecated, with its message (AC-2)', () => {
    if (!result?.indexed) return;
    const query = queryFrameworkApi(
      indexFor(result.symbols, version),
      'react',
      'componentWillMount',
    );
    expect(query.verdict).toBe('deprecated');
    expect(query.record?.message).toBeTruthy();
    // Rendered from JSDoc display parts, so a {@link} reference reads as its label rather
    // than as the mangled "componentDidMountcomponentDidMount" a naive join produces.
    expect(query.record?.message).not.toContain('componentDidMountcomponentDidMount');
  });

  it('finds deprecations at the top level too, not only in members', () => {
    if (!result?.indexed) return;
    const topLevel = result.symbols.filter(
      (symbol) => symbol.deprecated && !symbol.name.includes('.'),
    );
    expect(topLevel.length).toBeGreaterThan(0);
  });

  it('does not claim absence for an un-enumerated member of a real container', () => {
    if (!result?.indexed) return;
    const query = queryFrameworkApi(
      indexFor(result.symbols, version),
      'react',
      'Component.setState',
    );
    expect(query.verdict).toBe('unknown-dynamic');
  });

  it('suggests the nearest real symbol for a typo (AC-3)', () => {
    if (!result?.indexed) return;
    const query = queryFrameworkApi(indexFor(result.symbols, version), 'react', 'useEffct');
    expect(query.verdict).toBe('absent');
    expect(query.nearest).toBe('useEffect');
  });
});
