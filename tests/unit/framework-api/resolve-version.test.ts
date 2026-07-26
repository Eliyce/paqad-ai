import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveInstalledVersion,
  resolveTypesEntry,
  typesFromExports,
  typesPackageName,
} from '@/framework-api/resolve-version.js';

let root: string;

function installPackage(
  base: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): string {
  const dir = join(base, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-resolve-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveInstalledVersion', () => {
  it('reads the version from the installed package manifest, not from a range', () => {
    installPackage(root, 'react', { name: 'react', version: '19.2.6' });
    expect(resolveInstalledVersion(root, 'react')).toEqual({
      dir: join(root, 'node_modules', 'react'),
      version: '19.2.6',
    });
  });

  it('returns null when the package is declared but not installed', () => {
    expect(resolveInstalledVersion(root, 'react')).toBeNull();
  });

  it('returns null when the installed manifest is unparseable', () => {
    const dir = join(root, 'node_modules', 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(resolveInstalledVersion(root, 'broken')).toBeNull();
  });

  it('returns null when the manifest carries no usable version', () => {
    installPackage(root, 'react', { name: 'react' });
    expect(resolveInstalledVersion(root, 'react')).toBeNull();
    installPackage(root, 'vue', { name: 'vue', version: '' });
    expect(resolveInstalledVersion(root, 'vue')).toBeNull();
  });

  it('searches the manifest root it is given, not the project root', () => {
    // The monorepo case this repo itself has: react is installed under graph-ui.
    const subApp = join(root, 'graph-ui');
    installPackage(subApp, 'react', { name: 'react', version: '19.2.6' });
    expect(resolveInstalledVersion(root, 'react')).toBeNull();
    expect(resolveInstalledVersion(subApp, 'react')?.version).toBe('19.2.6');
  });
});

describe('typesPackageName', () => {
  it('maps a plain package to its DefinitelyTyped companion', () => {
    expect(typesPackageName('react')).toBe('@types/react');
  });

  it('flattens a scope with a double underscore, per the DefinitelyTyped convention', () => {
    expect(typesPackageName('@nestjs/core')).toBe('@types/nestjs__core');
  });
});

describe('typesFromExports', () => {
  it('reads a plain string export only when it points at declarations', () => {
    expect(typesFromExports('./index.d.ts')).toBe('./index.d.ts');
    expect(typesFromExports('./index.js')).toBeNull();
  });

  it('prefers the root subpath over sibling subpaths', () => {
    expect(
      typesFromExports({
        './jsx-runtime': { types: './jsx-runtime.d.ts' },
        '.': { types: './index.d.ts' },
      }),
    ).toBe('./index.d.ts');
  });

  it("resolves @types/react's version-gated condition tree to the current entry", () => {
    expect(
      typesFromExports({
        '.': {
          'types@<=5.0': { default: './ts5.0/index.d.ts' },
          types: { default: './index.d.ts' },
        },
      }),
    ).toBe('./index.d.ts');
  });

  it('falls back to a default condition that names declarations', () => {
    expect(typesFromExports({ default: './index.d.ts' })).toBe('./index.d.ts');
    expect(typesFromExports({ default: './index.js' })).toBeNull();
  });

  it('returns null for shapes that carry no declaration path', () => {
    expect(typesFromExports(undefined)).toBeNull();
    expect(typesFromExports(null)).toBeNull();
    expect(typesFromExports(['./index.d.ts'])).toBeNull();
    expect(typesFromExports({ '.': { import: './index.js' } })).toBeNull();
  });
});

describe('resolveTypesEntry', () => {
  it("prefers the package's own declared types field", () => {
    const dir = installPackage(
      root,
      'vue',
      { name: 'vue', version: '3.5.0', types: './dist/vue.d.ts' },
      { 'dist/vue.d.ts': 'export declare const ref: unknown;' },
    );
    expect(resolveTypesEntry(root, 'vue', dir)).toBe(join(dir, 'dist', 'vue.d.ts'));
  });

  it('accepts the legacy typings field', () => {
    const dir = installPackage(
      root,
      'vue',
      { name: 'vue', version: '3.5.0', typings: './legacy.d.ts' },
      { 'legacy.d.ts': 'export {};' },
    );
    expect(resolveTypesEntry(root, 'vue', dir)).toBe(join(dir, 'legacy.d.ts'));
  });

  it('falls back to the exports condition tree when no types field is declared', () => {
    const dir = installPackage(
      root,
      'vue',
      { name: 'vue', version: '3.5.0', exports: { '.': { types: './api.d.ts' } } },
      { 'api.d.ts': 'export {};' },
    );
    expect(resolveTypesEntry(root, 'vue', dir)).toBe(join(dir, 'api.d.ts'));
  });

  it('falls back to a conventional index.d.ts', () => {
    const dir = installPackage(
      root,
      'vue',
      { name: 'vue', version: '3.5.0' },
      { 'index.d.ts': 'export {};' },
    );
    expect(resolveTypesEntry(root, 'vue', dir)).toBe(join(dir, 'index.d.ts'));
  });

  it('skips a declared types path that does not exist on disk', () => {
    const dir = installPackage(
      root,
      'vue',
      { name: 'vue', version: '3.5.0', types: './missing.d.ts' },
      { 'index.d.ts': 'export {};' },
    );
    expect(resolveTypesEntry(root, 'vue', dir)).toBe(join(dir, 'index.d.ts'));
  });

  it('accepts an absolute declared types path', () => {
    const dir = installPackage(root, 'vue', { name: 'vue', version: '3.5.0' }, { 'abs.d.ts': '' });
    const absolute = join(dir, 'abs.d.ts');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '3.5.0', types: absolute }));
    expect(resolveTypesEntry(root, 'vue', dir)).toBe(absolute);
  });

  it('falls through to the @types companion — the react case', () => {
    // react itself ships no declarations; @types/react does.
    const dir = installPackage(root, 'react', { name: 'react', version: '19.2.6' });
    installPackage(
      root,
      '@types/react',
      { name: '@types/react', version: '19.2.15', types: './index.d.ts' },
      { 'index.d.ts': 'export declare function useId(): string;' },
    );
    expect(resolveTypesEntry(root, 'react', dir)).toBe(
      join(root, 'node_modules', '@types', 'react', 'index.d.ts'),
    );
  });

  it('returns null when neither the package nor a companion ships declarations', () => {
    const dir = installPackage(root, 'react', { name: 'react', version: '19.2.6' });
    expect(resolveTypesEntry(root, 'react', dir)).toBeNull();
  });

  it('returns null when the @types companion exists but ships no readable entry', () => {
    const dir = installPackage(root, 'react', { name: 'react', version: '19.2.6' });
    installPackage(root, '@types/react', { name: '@types/react', version: '19.2.15' });
    expect(resolveTypesEntry(root, 'react', dir)).toBeNull();
  });

  it('returns null when the package directory has no manifest at all', () => {
    expect(resolveTypesEntry(root, 'ghost', join(root, 'node_modules', 'ghost'))).toBeNull();
  });
});
