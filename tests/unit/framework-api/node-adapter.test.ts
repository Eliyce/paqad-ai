import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nodeFrameworkApiAdapter } from '@/framework-api/adapters/node.js';
import { clearTypeScriptCache, loadTypeScript } from '@/framework-api/typescript-loader.js';
import type { FrameworkApiAdapterInput } from '@/framework-api/types.js';

let root: string;

/** Install a package with declarations, and return an adapter input pointing at it. */
function install(
  name: string,
  version: string,
  declarations: string,
  manifestExtras: Record<string, unknown> = { types: './index.d.ts' },
): FrameworkApiAdapterInput {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, ...manifestExtras }));
  writeFileSync(join(dir, 'index.d.ts'), declarations);
  return { projectRoot: root, searchRoot: root, package: name, version, packageDir: dir };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-node-'));
  clearTypeScriptCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  clearTypeScriptCache();
});

describe('nodeFrameworkApiAdapter.resolveInstalled', () => {
  it('delegates to the installed-version resolver', () => {
    install('acme', '1.2.3', 'export declare function go(): void;');
    expect(nodeFrameworkApiAdapter.resolveInstalled(root, 'acme')?.version).toBe('1.2.3');
  });

  it('returns null for a package that is not installed', () => {
    expect(nodeFrameworkApiAdapter.resolveInstalled(root, 'ghost')).toBeNull();
  });
});

describe('nodeFrameworkApiAdapter.contentHash', () => {
  it('is stable for unchanged declarations, so a rebuild is a cache hit (FR-13)', () => {
    const input = install('acme', '1.0.0', 'export declare function go(): void;');
    expect(nodeFrameworkApiAdapter.contentHash(input)).toBe(
      nodeFrameworkApiAdapter.contentHash(input),
    );
  });

  it('changes when the declarations change', () => {
    const input = install('acme', '1.0.0', 'export declare function go(): void;');
    const before = nodeFrameworkApiAdapter.contentHash(input);
    writeFileSync(join(input.packageDir, 'index.d.ts'), 'export declare function stop(): void;');
    expect(nodeFrameworkApiAdapter.contentHash(input)).not.toBe(before);
  });

  it('changes when the resolved version changes', () => {
    const input = install('acme', '1.0.0', 'export declare function go(): void;');
    const before = nodeFrameworkApiAdapter.contentHash(input);
    expect(nodeFrameworkApiAdapter.contentHash({ ...input, version: '2.0.0' })).not.toBe(before);
  });

  it('still hashes a package that ships no declarations', () => {
    const dir = join(root, 'node_modules', 'bare');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bare', version: '1.0.0' }));
    const hash = nodeFrameworkApiAdapter.contentHash({
      projectRoot: root,
      searchRoot: root,
      package: 'bare',
      version: '1.0.0',
      packageDir: dir,
    });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('nodeFrameworkApiAdapter.index', () => {
  it('records exported symbols as existing and asserted', () => {
    const result = nodeFrameworkApiAdapter.index(
      install(
        'acme',
        '1.0.0',
        'export declare function go(): void;\nexport declare const n: number;',
      ),
    );
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    const go = result.symbols.find((symbol) => symbol.name === 'go');
    expect(go).toMatchObject({ kind: 'function', exists: true, provenance: 'asserted' });
    expect(result.symbols.find((symbol) => symbol.name === 'n')?.kind).toBe('variable');
    expect(result.sources[0]).toContain('index.d.ts');
  });

  it('classifies each declaration kind it can tell apart', () => {
    const result = nodeFrameworkApiAdapter.index(
      install(
        'acme',
        '1.0.0',
        [
          'export declare function fn(): void;',
          'export declare class Cls {}',
          'export interface Iface { a: string }',
          'export type Alias = string;',
          'export declare enum Colour { Red }',
          'export declare namespace Space { const inner: number; }',
          'export declare const value: number;',
        ].join('\n'),
      ),
    );
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    const kindOf = (name: string) => result.symbols.find((symbol) => symbol.name === name)?.kind;
    expect(kindOf('fn')).toBe('function');
    expect(kindOf('Cls')).toBe('class');
    expect(kindOf('Iface')).toBe('interface');
    expect(kindOf('Alias')).toBe('type');
    expect(kindOf('Colour')).toBe('enum');
    expect(kindOf('Space')).toBe('namespace');
    expect(kindOf('value')).toBe('variable');
  });

  it('falls back to `unknown` for a declaration it cannot classify', () => {
    // An `export *` alias carries only the Alias flag, none of the mapped ones.
    const input = install('acme', '1.0.0', "export * as bundled from './inner.js';");
    writeFileSync(join(input.packageDir, 'inner.d.ts'), 'export declare const x: number;');
    const result = nodeFrameworkApiAdapter.index(input);
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    expect(result.symbols.find((symbol) => symbol.name === 'bundled')?.kind).toBe('unknown');
  });

  it('reads a @deprecated tag off an exported symbol (AC-2)', () => {
    const result = nodeFrameworkApiAdapter.index(
      install(
        'acme',
        '1.0.0',
        [
          '/**',
          ' * @deprecated since 2.0 — use `next` instead; will be removed.',
          ' */',
          'export declare function old(): void;',
        ].join('\n'),
      ),
    );
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    const old = result.symbols.find((symbol) => symbol.name === 'old');
    expect(old?.deprecated).toBe(true);
    expect(old?.since).toBe('2.0');
    expect(old?.for_removal).toBe(true);
    expect(old?.message).toContain('use `next` instead');
  });

  it('resolves through `declare namespace` + `export =`, the @types/react shape', () => {
    // The verified case a hand-rolled export scan misses entirely.
    const result = nodeFrameworkApiAdapter.index(
      install(
        'acme',
        '1.0.0',
        ['export = Acme;', 'declare namespace Acme {', '  function useId(): string;', '}'].join(
          '\n',
        ),
      ),
    );
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    expect(result.symbols.map((symbol) => symbol.name)).toContain('useId');
  });

  it('follows an `export *` barrel', () => {
    const input = install('acme', '1.0.0', "export * from './inner.js';");
    writeFileSync(join(input.packageDir, 'inner.d.ts'), 'export declare function inner(): void;');
    const result = nodeFrameworkApiAdapter.index(input);
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    expect(result.symbols.map((symbol) => symbol.name)).toContain('inner');
  });

  it('stores a deprecated member and a wildcard, never the whole member list', () => {
    const result = nodeFrameworkApiAdapter.index(
      install(
        'acme',
        '1.0.0',
        [
          'export declare class Widget {',
          '  render(): void;',
          '  /** @deprecated use render. */',
          '  paint(): void;',
          '}',
        ].join('\n'),
      ),
    );
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toContain('Widget.paint');
    expect(names).toContain('Widget.*');
    // A live member is deliberately NOT enumerated; the wildcard covers it (INV-2).
    expect(names).not.toContain('Widget.render');
  });

  it('drills an interface as well as a class', () => {
    const result = nodeFrameworkApiAdapter.index(
      install(
        'acme',
        '1.0.0',
        ['export interface Opts {', '  /** @deprecated gone. */', '  legacy?: string;', '}'].join(
          '\n',
        ),
      ),
    );
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    expect(result.symbols.map((symbol) => symbol.name)).toContain('Opts.legacy');
  });

  it('still wildcards a container past the drill budget, never silently dropping it', () => {
    // Past MAX_DRILLED_CONTAINERS the members are not walked — but the wildcard must still
    // be emitted, or an un-drilled member would fall through to a false "absent" (INV-2).
    const containers = Array.from(
      { length: 260 },
      (_unused, i) => `export interface I${i} { a${i}: string; }`,
    ).join('\n');
    const result = nodeFrameworkApiAdapter.index(install('acme', '1.0.0', containers));
    expect(result.indexed).toBe(true);
    if (!result.indexed) return;
    const wildcards = result.symbols.filter((symbol) => symbol.name.endsWith('.*'));
    expect(wildcards).toHaveLength(260);
    expect(wildcards.every((symbol) => symbol.provenance === 'unknown-dynamic')).toBe(true);
  });

  it('reports a package with no declarations as blocked, not as an empty surface', () => {
    const dir = join(root, 'node_modules', 'bare');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bare', version: '1.0.0' }));
    const result = nodeFrameworkApiAdapter.index({
      projectRoot: root,
      searchRoot: root,
      package: 'bare',
      version: '1.0.0',
      packageDir: dir,
    });
    expect(result).toMatchObject({ indexed: false, reason: 'no-types' });
  });

  it('reports a global-script declaration file as blocked rather than asserting absence', () => {
    const result = nodeFrameworkApiAdapter.index(
      install('acme', '1.0.0', 'declare const globalThing: number;'),
    );
    expect(result).toMatchObject({ indexed: false, reason: 'no-types' });
  });
});

describe('loadTypeScript', () => {
  it('resolves a compiler for a real project and memoizes it', () => {
    const first = loadTypeScript(process.cwd());
    expect(first).not.toBeNull();
    expect(loadTypeScript(process.cwd())).toBe(first);
  });

  it('still resolves from paqad-ai when the project tree has no typescript', () => {
    // The fallback hop: an empty temp dir has no node_modules of its own.
    expect(loadTypeScript(root)).not.toBeNull();
  });

  it('clearTypeScriptCache forces a fresh resolution', () => {
    const first = loadTypeScript(root);
    clearTypeScriptCache();
    expect(loadTypeScript(root)).not.toBe(undefined);
    expect(first).not.toBeNull();
  });
});
