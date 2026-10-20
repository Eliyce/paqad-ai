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
