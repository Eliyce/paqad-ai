import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const distDir = join(repoRoot, 'dist');
const runtimeDir = join(repoRoot, 'runtime');

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

const EXTERNAL_DEPS = ['@huggingface/transformers', 'openai', 'voyageai'];

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
  if (!existsSync(join(distDir, 'index.js'))) {
    execFileSync('pnpm', ['run', 'build:server'], { cwd: repoRoot, stdio: 'ignore' });
  }
}, 240_000);

describe('plugin dist is self-contained', () => {
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
      expect(existsSync(join(sandbox, 'node_modules'))).toBe(false);
    });

    afterAll(() => {
      if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    });

    for (const entry of DIST_ENTRIES) {
      it(`imports dist/${entry}`, () => {
        const target = pathToFileURL(join(sandbox, 'dist', entry)).href;
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
