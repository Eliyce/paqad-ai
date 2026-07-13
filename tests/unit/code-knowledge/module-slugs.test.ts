import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadModuleSlugResolver } from '@/code-knowledge/module-slugs.js';
import { PATHS } from '@/core/constants/paths.js';

function writeMap(root: string, yaml: string): void {
  const dir = join(root, 'docs', 'instructions', 'rules');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, PATHS.MODULE_MAP), yaml);
}

describe('loadModuleSlugResolver', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-slugs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves via this repo's version:2 `sources` (incl. nested feature sources)", () => {
    writeMap(
      root,
      [
        'version: 2',
        'modules:',
        '  - slug: cli',
        '    sources:',
        '      - src/cli',
        '    features:',
        '      - slug: onboard',
        '        sources: [src/onboarding]',
        '  - slug: core',
        '    sources: [src/core]',
      ].join('\n'),
    );
    const resolver = loadModuleSlugResolver(root);
    expect(resolver.slugForFile('src/cli/commands/index.ts')).toBe('cli');
    expect(resolver.slugForFile('src/onboarding/run.ts')).toBe('cli');
    expect(resolver.slugForFile('src/core/paths.ts')).toBe('core');
    expect(resolver.slugForFile('src/unknown/x.ts')).toBeNull();
    expect(resolver.slugs()).toEqual(['cli', 'core']);
  });

  it('resolves via the standard `source_paths` shape', () => {
    writeMap(root, ['modules:', '  - slug: api', '    source_paths: [src/api]'].join('\n'));
    expect(loadModuleSlugResolver(root).slugForFile('src/api/routes.ts')).toBe('api');
  });

  it('gives the longest matching source path to the most specific module', () => {
    writeMap(
      root,
      [
        'modules:',
        '  - slug: broad',
        '    sources: [src]',
        '  - slug: narrow',
        '    sources: [src/feature]',
      ].join('\n'),
    );
    const resolver = loadModuleSlugResolver(root);
    expect(resolver.slugForFile('src/feature/x.ts')).toBe('narrow');
    expect(resolver.slugForFile('src/other/y.ts')).toBe('broad');
  });

  it('picks the longest match even when the broader module is declared later', () => {
    writeMap(
      root,
      [
        'modules:',
        '  - slug: narrow',
        '    sources: [src/feature]',
        '  - slug: broad',
        '    sources: [src]',
      ].join('\n'),
    );
    // narrow matches first (best), broad matches after but is shorter -> stays narrow.
    expect(loadModuleSlugResolver(root).slugForFile('src/feature/x.ts')).toBe('narrow');
  });

  it('matches a source path that names an exact file', () => {
    writeMap(root, ['modules:', '  - slug: one', '    sources: [src/one.ts]'].join('\n'));
    expect(loadModuleSlugResolver(root).slugForFile('src/one.ts')).toBe('one');
  });

  it('is empty when the map is missing', () => {
    const resolver = loadModuleSlugResolver(root);
    expect(resolver.slugForFile('src/x.ts')).toBeNull();
    expect(resolver.slugs()).toEqual([]);
  });

  it('is empty when the map is malformed', () => {
    writeMap(root, ': : not yaml : :');
    expect(loadModuleSlugResolver(root).slugForFile('src/x.ts')).toBeNull();
  });

  it('ignores modules without a slug or without any source', () => {
    writeMap(
      root,
      [
        'modules:',
        '  - sources: [src/noslug]',
        '  - slug: nosrc',
        '  - slug: ok',
        '    sources: [src/ok]',
      ].join('\n'),
    );
    const resolver = loadModuleSlugResolver(root);
    expect(resolver.slugForFile('src/noslug/x.ts')).toBeNull();
    expect(resolver.slugs()).toEqual(['ok']);
  });
});
