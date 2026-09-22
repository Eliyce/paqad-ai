// Hook-to-bundler-entry parity (issue #573).
//
// Every runtime hook that lazy-imports its compiled half does so by a literal
// `../../dist/<path>.js` URL, resolved against the INSTALLED package layout. tsup emits
// only the modules named in its `entry` map, so a hook can reference a path the build
// never produces — and because each hook wraps the import in a soft-fail, the resulting
// ERR_MODULE_NOT_FOUND is silent. That is exactly how the prompt-route seam
// (`dist/pipeline/prompt-lane.js`, from #324) and the ticket-reference detector
// (`dist/planning/ticket-ref-detect.js`, from #330) shipped dead for ~10 weeks: unit
// tests import the SOURCE through the vitest alias, so they passed the whole time.
//
// This test closes that gap by deriving the expectation from the hooks themselves rather
// than from a hand-kept list, so a newly added hook is covered the moment it is written.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const HOOKS_DIR = join(REPO_ROOT, 'runtime', 'hooks');

/** Matches the `../../dist/<path>.js` specifier form every hook uses. */
const DIST_IMPORT = /['"]\.\.\/\.\.\/dist\/([A-Za-z0-9/._-]+)\.js['"]/g;

interface DistImport {
  /** Hook file the import was found in, relative to `runtime/hooks`. */
  hook: string;
  /** The tsup entry name the specifier implies, e.g. `pipeline/prompt-lane`. */
  entry: string;
}

/** Every `.mjs` under `runtime/hooks`, including `lib/`, relative to that directory. */
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

/** Scan the hook sources for their compiled-half imports. */
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

/**
 * The declared tsup entry names. Read as text rather than imported: the config is ESM
 * TypeScript with a top-level `readFileSync`, and the entry map is a plain object
 * literal, so a line scan is both cheaper and immune to the config's side effects.
 */
function declaredEntries(): Set<string> {
  const config = readFileSync(join(REPO_ROOT, 'tsup.config.ts'), 'utf8');
  const entryBlock = config.slice(config.indexOf('entry: {'), config.indexOf('format:'));
  const entries = new Set<string>();
  for (const match of entryBlock.matchAll(/^\s*'?([A-Za-z0-9/._-]+)'?\s*:\s*'src\//gm)) {
    entries.add(match[1]);
  }
  return entries;
}

describe('runtime hook -> tsup entry parity (issue #573)', () => {
  it('finds the compiled-half imports it is meant to guard', () => {
    // A scan that silently matched nothing would pass every assertion below, so prove the
    // regex still finds real imports before trusting the parity check (RULE-11 RL-1dc7).
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
    // Regression pins: these are the exact imports #573 found broken.
    const entries = declaredEntries();
    expect(entries.has('pipeline/prompt-lane')).toBe(true);
    expect(entries.has('planning/ticket-ref-detect')).toBe(true);
  });

  it('flags a hook whose dist import has no matching entry', () => {
    // The detection itself, exercised against a synthetic hook source so the guard is
    // proven to FAIL when it should, not only to pass on a clean tree.
    const source = "const u = new URL('../../dist/not/an-entry.js', import.meta.url);";
    const found = [...source.matchAll(DIST_IMPORT)].map((match) => match[1]);
    expect(found).toEqual(['not/an-entry']);
    expect(declaredEntries().has('not/an-entry')).toBe(false);
  });
});
