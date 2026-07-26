import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  moduleRecords,
  pythonDeprecationTags,
  pythonFrameworkApiAdapter,
  readDunderAll,
} from '@/framework-api/adapters/python.js';
import { queryFrameworkApi } from '@/framework-api/query.js';
import type { FrameworkApiAdapterInput, FrameworkApiIndex } from '@/framework-api/types.js';

let root: string;

/**
 * Install a distribution into a venv-shaped site-packages, with its dist-info METADATA and
 * whatever module files the test needs.
 */
function install(
  dist: string,
  version: string,
  files: Record<string, string>,
  options: { sitePackages?: string[]; metadata?: string } = {},
): FrameworkApiAdapterInput {
  const site = join(root, ...(options.sitePackages ?? ['.venv', 'lib', 'python3.12', 'site-packages']));
  const distInfo = join(site, `${dist}-${version}.dist-info`);
  mkdirSync(distInfo, { recursive: true });
  writeFileSync(
    join(distInfo, 'METADATA'),
    options.metadata ?? `Metadata-Version: 2.1\nName: ${dist}\nVersion: ${version}\n`,
  );
  const packageDir = join(site, dist.toLowerCase());
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(packageDir, relative);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return { projectRoot: root, searchRoot: root, package: dist, version, packageDir };
}

/** Wrap an adapter result's symbols in a minimal index, so the query path can be used. */
function asIndex(input: FrameworkApiAdapterInput): FrameworkApiIndex {
  const result = pythonFrameworkApiAdapter.index(input);
  if (!result.indexed) {
    throw new Error(`expected an indexed result, got ${result.reason}: ${result.detail}`);
  }
  return {
    schema_version: 1,
    header: { generated_at: '2026-07-26T00:00:00.000Z', schema_version: 1 },
    packages: [
      {
        package: input.package,
        version: input.version,
        ecosystem: 'python',
        root: '.',
        content_hash: 'sha256:test',
        sources: result.sources,
        symbols: result.symbols,
      },
    ],
    blocked: [],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-python-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readDunderAll', () => {
  it('reads a multi-line __all__', () => {
    expect(readDunderAll('__all__ = [\n    "Flask",\n    "request",\n]\n')).toEqual([
      'Flask',
      'request',
    ]);
  });

  it('reads a type-annotated __all__ tuple', () => {
    expect(readDunderAll('__all__: tuple[str, ...] = ("a", "b")')).toEqual(['a', 'b']);
  });

  it('returns nothing when the module declares none', () => {
    expect(readDunderAll('def go():\n    pass\n')).toEqual([]);
  });
});

describe('pythonDeprecationTags', () => {
  it('reads a PEP 702 @deprecated decorator (AC-2)', () => {
    expect(pythonDeprecationTags('@deprecated("use go2() instead")\n', 'pass')).toEqual([
      { name: 'deprecated', text: [{ text: 'use go2() instead' }] },
    ]);
  });

  it('reads a namespaced typing_extensions.deprecated decorator', () => {
    expect(pythonDeprecationTags('@typing_extensions.deprecated("gone in 4.0")\n', '')).toEqual([
      { name: 'deprecated', text: [{ text: 'gone in 4.0' }] },
    ]);
  });

  it('falls back to a DeprecationWarning in the body', () => {
    expect(
      pythonDeprecationTags('', '    warnings.warn("go() is deprecated", DeprecationWarning)\n'),
    ).toEqual([{ name: 'deprecated', text: [{ text: 'go() is deprecated' }] }]);
  });

  it('ignores an unrelated warning', () => {
    expect(pythonDeprecationTags('', '    warnings.warn("careful", UserWarning)\n')).toEqual([]);
  });
});

describe('moduleRecords', () => {
  it('records module-level defs and classes with their deprecation', () => {
    const records = moduleRecords(
      'acme',
      `import warnings


@deprecated("use fresh() instead")
def stale():
    pass


def fresh():
    pass


class Thing:
    pass
`,
    );
    expect(records.map((record) => record.name)).toEqual([
      'acme.stale',
      'acme.fresh',
      'acme.Thing',
      'acme.*',
    ]);
    expect(records[0]).toMatchObject({ deprecated: true, message: 'use fresh() instead.' });
    expect(records[2]?.kind).toBe('class');
  });

  it('honours __all__ as the public surface and skips private names', () => {
    const records = moduleRecords(
      'acme',
      `__all__ = ["public"]


def public():
    pass


def internal():
    pass


def _private():
    pass
`,
    );
    expect(records.map((record) => record.name)).toEqual(['acme.public', 'acme.*']);
  });

  it('records an __all__ name that no visible declaration backs, rather than dropping it', () => {
    const records = moduleRecords('acme', '__all__ = ["reexported"]\n');
    expect(records[0]).toMatchObject({ name: 'acme.reexported', exists: true, kind: 'unknown' });
  });

  it('records a repeated declaration once', () => {
    const records = moduleRecords('acme', 'def go():\n    pass\n\n\ndef go():\n    pass\n');
    expect(records.filter((record) => record.name === 'acme.go')).toHaveLength(1);
  });
});

describe('pythonFrameworkApiAdapter.resolveInstalled', () => {
  it('reads the version from the dist-info METADATA (FR-3)', () => {
    install('Flask', '3.1.2', { '__init__.py': 'def go():\n    pass\n' });
    expect(pythonFrameworkApiAdapter.resolveInstalled(root, 'Flask')?.version).toBe('3.1.2');
  });

  it('matches a distribution whose name differs only in case and separators', () => {
    install('typing_extensions', '4.12.0', { '__init__.py': '' });
    expect(pythonFrameworkApiAdapter.resolveInstalled(root, 'typing-extensions')?.version).toBe(
      '4.12.0',
    );
  });

  it('finds a distribution in a bare site-packages directory', () => {
    install('flask', '3.0.0', { '__init__.py': '' }, { sitePackages: ['site-packages'] });
    expect(pythonFrameworkApiAdapter.resolveInstalled(root, 'flask')?.version).toBe('3.0.0');
  });

  it('returns null when nothing is installed', () => {
    expect(pythonFrameworkApiAdapter.resolveInstalled(root, 'flask')).toBeNull();
  });

  it('returns null when the dist-info carries no Version field', () => {
    install('flask', '3.0.0', { '__init__.py': '' }, { metadata: 'Name: flask\n' });
    expect(pythonFrameworkApiAdapter.resolveInstalled(root, 'flask')).toBeNull();
  });

  it('falls back to site-packages when the distribution ships no import directory', () => {
    const input = install('flask', '3.0.0', {});
    const resolved = pythonFrameworkApiAdapter.resolveInstalled(root, 'flask');
    expect(resolved?.dir).not.toBe(input.packageDir);
    expect(resolved?.version).toBe('3.0.0');
  });
});

describe('pythonFrameworkApiAdapter.contentHash', () => {
  it('is stable for an unchanged module and changes with it (FR-13)', () => {
    const input = install('acme', '1.0.0', { '__init__.py': 'def go():\n    pass\n' });
    const before = pythonFrameworkApiAdapter.contentHash(input);
    expect(pythonFrameworkApiAdapter.contentHash(input)).toBe(before);
    writeFileSync(join(input.packageDir, '__init__.py'), 'def stop():\n    pass\n');
    expect(pythonFrameworkApiAdapter.contentHash(input)).not.toBe(before);
  });

  it('still hashes a distribution with no module entry at all', () => {
    const input = install('acme', '1.0.0', {});
    expect(pythonFrameworkApiAdapter.contentHash(input)).toMatch(/^sha256:/);
  });
});

describe('pythonFrameworkApiAdapter.index', () => {
  it('prefers the typed .pyi stub over the .py module', () => {
    const input = install('acme', '1.0.0', {
      '__init__.py': 'def from_py():\n    pass\n',
      '__init__.pyi': 'def from_stub() -> None: ...\n',
    });
    const result = pythonFrameworkApiAdapter.index(input);
    expect(result.indexed).toBe(true);
    if (!result.indexed) {
      return;
    }
    expect(result.symbols.map((record) => record.name)).toContain('acme.from_stub');
    expect(result.sources[0]?.endsWith('__init__.pyi')).toBe(true);
  });

  it('normalizes a hyphenated distribution to its import name', () => {
    const input = { ...install('typing-extensions', '4.12.0', { '__init__.py': 'def go():\n    pass\n' }) };
    const result = pythonFrameworkApiAdapter.index(input);
    expect(result.indexed).toBe(true);
    if (!result.indexed) {
      return;
    }
    expect(result.symbols.map((record) => record.name)).toContain('typing_extensions.go');
  });

  it('blocks a distribution that ships no importable module', () => {
    const input = install('acme', '1.0.0', { 'README.md': 'nothing' });
    expect(pythonFrameworkApiAdapter.index(input)).toMatchObject({
      indexed: false,
      reason: 'no-types',
    });
  });
});

describe('the Python entry answered through the query', () => {
  it('answers live, deprecated and unknown-dynamic in the tiers the gate expects (AC-4)', () => {
    const input = install('acme', '2.0.0', {
      '__init__.py': `@deprecated("use fresh() instead")
def stale():
    pass


def fresh():
    pass
`,
    });
    const index = asIndex(input);
    expect(queryFrameworkApi(index, 'acme', 'fresh').verdict).toBe('live');
    expect(queryFrameworkApi(index, 'acme', 'acme.stale').verdict).toBe('deprecated');
    expect(queryFrameworkApi(index, 'acme', 'acme.something_dynamic').verdict).toBe(
      'unknown-dynamic',
    );
  });
});
