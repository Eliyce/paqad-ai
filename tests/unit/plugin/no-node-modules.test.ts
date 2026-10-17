import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Issue #616, Part 2 (INV-2 / AC-2): the Claude Code plugin works the moment it is downloaded —
// Claude Code installs no packages for an npm-source plugin that ships no lockfile, so `dist/`
// must be self-contained. These tests prove that the built `dist/` (a) carries no bare import of a
// pure-JS dependency that bundling was supposed to inline, and (b) imports successfully from a
// directory that has no `node_modules` at all. Only the three heavy embedding engines
// (@huggingface/transformers, openai, voyageai) stay external, and they are lazy — a top-level
// import never reaches them.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const distDir = join(repoRoot, 'dist');
const runtimeDir = join(repoRoot, 'runtime');

// Deps forced back into the bundle by `noExternal` in tsup.config.ts — none may remain as a bare
// runtime import in dist/*.js, or the plugin breaks with no node_modules.
const BUNDLED_DEPS = [
  'ajv',
  'execa',
  'fast-glob',
  'pathe',
  'yaml',
  'handlebars',
  'chalk',
  '@inquirer/prompts',
  'commander',
  'ora',
  'gifenc',
];

// The still-external, lazy embedding engines — allowed to appear only inside a dynamic `import()`.
const EXTERNAL_DEPS = ['@huggingface/transformers', 'openai', 'voyageai'];

// Dist entry bundles the plugin's hooks and CLI load. If bundling is incomplete, importing one of
// these from a node_modules-less directory throws ERR_MODULE_NOT_FOUND.
const DIST_ENTRIES = [
  'index.js',
  'cli/index.js',
  'kernel/gate.js',
  'stage-evidence/live-writer.js',
  'pipeline/prompt-lane.js',
  'context/tokenizer-cache.js',
];

function listJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

beforeAll(() => {
  // CI runs `test:coverage` before `build`, so dist may be absent or stale here. Build it once so
  // the guarantee is checked against a real, current bundle rather than skipped.
  if (!existsSync(join(distDir, 'index.js'))) {
    execFileSync('pnpm', ['run', 'build:server'], { cwd: repoRoot, stdio: 'ignore' });
  }
}, 240_000);

describe('plugin dist is self-contained (issue #616, Part 2)', () => {
  it('has no bare import of a bundled dependency in any dist/*.js', () => {
    const offenders: string[] = [];
    const bare = new RegExp(
      `(?:from|require\\()\\s*['"](${BUNDLED_DEPS.map((d) => d.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})['"]`,
    );
    for (const file of listJsFiles(distDir)) {
      const text = readFileSync(file, 'utf8');
      if (bare.test(text)) offenders.push(`${file.slice(distDir.length + 1)}`);
    }
    expect(offenders, `bundled deps still external in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps the heavy engines external only inside a lazy dynamic import()', () => {
    // A static top-level `import X from 'openai'` would be loaded eagerly and break with no
    // node_modules; the only allowed form is `await import('openai')`.
    for (const dep of EXTERNAL_DEPS) {
      const escaped = dep.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
      const staticImport = new RegExp(`(?:^|\\n)\\s*import[^\\n]*['"]${escaped}['"]`);
      for (const file of listJsFiles(distDir)) {
        const text = readFileSync(file, 'utf8');
        expect(staticImport.test(text), `${dep} statically imported in ${file}`).toBe(false);
      }
    }
  });

  describe('imports with no node_modules present', () => {
    let sandbox: string;

    beforeAll(() => {
      sandbox = mkdtempSync(join(tmpdir(), 'paqad-plugin-selfcontained-'));
      cpSync(distDir, join(sandbox, 'dist'), { recursive: true });
      cpSync(runtimeDir, join(sandbox, 'runtime'), { recursive: true });
      // No node_modules is copied — the sandbox lives under the OS temp dir, which has none up its
      // tree, so any unbundled bare import fails to resolve.
      expect(existsSync(join(sandbox, 'node_modules'))).toBe(false);
    });

    afterAll(() => {
      if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    });

    for (const entry of DIST_ENTRIES) {
      it(`imports dist/${entry}`, () => {
        const target = pathToFileURL(join(sandbox, 'dist', entry)).href;
        // Spawn a fresh node whose module resolution is anchored at the sandbox, so the import
        // cannot fall back to the repo's node_modules.
        expect(() =>
          execFileSync(
            process.execPath,
            ['--input-type=module', '-e', `await import(${JSON.stringify(target)});`],
            {
              cwd: sandbox,
              stdio: 'pipe',
            },
          ),
        ).not.toThrow();
      });
    }
  });
});
