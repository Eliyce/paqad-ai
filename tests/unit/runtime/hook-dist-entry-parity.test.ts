import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const HOOKS_DIR = join(REPO_ROOT, 'runtime', 'hooks');

const DIST_IMPORT = /['"]\.\.\/\.\.\/dist\/([A-Za-z0-9/._-]+)\.js['"]/g;

interface DistImport {
  hook: string;
  entry: string;
}

function hookFiles(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...hookFiles(join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.mjs')) {
      found.push(rel);
    }
  }
  return found.sort();
}

function distImports(): DistImport[] {
  const imports: DistImport[] = [];
  for (const hook of hookFiles(HOOKS_DIR)) {
    const source = readFileSync(join(HOOKS_DIR, hook), 'utf8');
    for (const match of source.matchAll(DIST_IMPORT)) {
      imports.push({ hook, entry: match[1] });
    }
  }
  return imports;
}

function declaredEntries(): Set<string> {
  const config = readFileSync(join(REPO_ROOT, 'tsup.config.ts'), 'utf8');
  const entryBlock = config.slice(config.indexOf('entry: {'), config.indexOf('format:'));
  const entries = new Set<string>();
  for (const match of entryBlock.matchAll(/^\s*'?([A-Za-z0-9/._-]+)'?\s*:\s*'src\//gm)) {
    entries.add(match[1]);
  }
  return entries;
}

describe('runtime hook -> tsup entry parity', () => {
  it('finds the compiled-half imports it is meant to guard', () => {
    const imports = distImports();
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.map((entry) => entry.entry)).toContain('pipeline/prompt-lane');
  });

  it('reads a non-empty tsup entry map', () => {
    const entries = declaredEntries();
    expect(entries.size).toBeGreaterThan(0);
    expect(entries.has('index')).toBe(true);
  });

  it('declares a tsup entry for every dist path a runtime hook imports', () => {
    const entries = declaredEntries();
    const dangling = distImports()
      .filter((entry) => !entries.has(entry.entry))
      .map((entry) => `${entry.hook} imports dist/${entry.entry}.js with no tsup entry`);

    expect(dangling).toEqual([]);
  });

  it('covers the two entries that shipped dangling', () => {
    const entries = declaredEntries();
    expect(entries.has('pipeline/prompt-lane')).toBe(true);
    expect(entries.has('planning/ticket-ref-detect')).toBe(true);
  });

  it('flags a hook whose dist import has no matching entry', () => {
    const source = "const u = new URL('../../dist/not/an-entry.js', import.meta.url);";
    const found = [...source.matchAll(DIST_IMPORT)].map((match) => match[1]);
    expect(found).toEqual(['not/an-entry']);
    expect(declaredEntries().has('not/an-entry')).toBe(false);
  });
});
