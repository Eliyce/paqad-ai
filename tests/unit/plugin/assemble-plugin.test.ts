import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assemblePlugin,
  PLUGIN_MARKETPLACE,
  PLUGIN_REPO,
} from '../../../scripts/assemble-plugin.mjs';

const SCRIPT = resolve('scripts/assemble-plugin.mjs');
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, text = 'x'): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function builtRepo(version = '1.99.4', pluginVersion = version): string {
  const root = tempDir('paqad-assemble-repo-');
  write(root, 'package.json', JSON.stringify({ name: 'paqad-ai', version }));
  write(
    root,
    '.claude-plugin/plugin.json',
    JSON.stringify({ name: 'paqad', version: pluginVersion }),
  );
  write(root, 'dist/cli/index.js');
  write(root, 'runtime/hooks/agent-entry-gate.mjs');
  write(root, 'runtime/claude-plugin/hooks.json', '{}');
  write(root, 'runtime/claude-plugin/mod/register.tsx');
  write(root, 'runtime/claude-plugin/mod/register.test.ts');
  write(root, 'runtime/claude-plugin/mod/types/index.d.ts');
  write(root, 'runtime/claude-plugin/mod/test/world.ts');
  write(root, 'README.md');
  write(root, 'LICENSE');
  write(root, 'CHANGELOG.md');
  write(root, 'src/index.ts');
  write(root, 'tests/unit/a.test.ts');
  return root;
}

describe('scripts/assemble-plugin.mjs', () => {
  it('writes the plugin tree and nothing else', () => {
    const repoRoot = builtRepo();
    const outDir = join(tempDir('paqad-assemble-out-'), 'plugin');
    expect(assemblePlugin({ repoRoot, outDir })).toEqual({ version: '1.99.4', outDir });
    expect(readdirSync(outDir).sort()).toEqual(
      ['.claude-plugin', 'LICENSE', 'README.md', 'dist', 'package.json', 'runtime'].sort(),
    );
    expect(readdirSync(join(outDir, '.claude-plugin')).sort()).toEqual([
      'marketplace.json',
      'plugin.json',
    ]);
    expect(existsSync(join(outDir, 'dist/cli/index.js'))).toBe(true);
    expect(existsSync(join(outDir, 'runtime/hooks/agent-entry-gate.mjs'))).toBe(true);
    expect(existsSync(join(outDir, 'runtime/claude-plugin/mod/register.tsx'))).toBe(true);
    expect(existsSync(join(outDir, 'runtime/claude-plugin/mod/types/index.d.ts'))).toBe(true);
    expect(existsSync(join(outDir, 'runtime/claude-plugin/mod/register.test.ts'))).toBe(false);
    expect(existsSync(join(outDir, 'runtime/claude-plugin/mod/test'))).toBe(false);
  });

  it('keeps the clone history and removes everything an older publish left', () => {
    const repoRoot = builtRepo();
    const outDir = tempDir('paqad-assemble-clone-');
    write(outDir, '.git/HEAD', 'ref: refs/heads/main\n');
    write(outDir, 'old-file.txt');
    write(outDir, 'dist/stale.js');
    assemblePlugin({ repoRoot, outDir });
    expect(existsSync(join(outDir, '.git/HEAD'))).toBe(true);
    expect(existsSync(join(outDir, 'old-file.txt'))).toBe(false);
    expect(existsSync(join(outDir, 'dist/stale.js'))).toBe(false);
  });

  it('writes the eliyce marketplace with the paqad plugin at the root of the assembled tree', () => {
    const repoRoot = builtRepo();
    const outDir = tempDir('paqad-assemble-market-');
    write(outDir, '.git/HEAD', 'ref: refs/heads/main\n');
    write(outDir, '.claude-plugin/marketplace.json', '{"name":"stale"}');
    assemblePlugin({ repoRoot, outDir });
    const marketplace = JSON.parse(
      readFileSync(join(outDir, '.claude-plugin/marketplace.json'), 'utf8'),
    ) as { name: string; plugins: { name: string; source: unknown }[] };
    expect(marketplace).toEqual(PLUGIN_MARKETPLACE);
    expect(marketplace.name).toBe('eliyce');
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]!.name).toBe('paqad');
    expect(marketplace.plugins[0]!.source).toBe('./');
    expect(PLUGIN_REPO).toBe('Eliyce/paqad-claude-plugin');
  });

  it('refuses a plugin.json that the build did not stamp with the package version', () => {
    const repoRoot = builtRepo('1.99.4', '1.95.1');
    expect(() => assemblePlugin({ repoRoot, outDir: tempDir('paqad-assemble-out-') })).toThrow(
      'plugin.json is at 1.95.1 but package.json is at 1.99.4. Run pnpm build first.',
    );
  });

  it('refuses an unbuilt repository and an output folder that holds the repository', () => {
    const repoRoot = builtRepo();
    rmSync(join(repoRoot, 'dist'), { recursive: true });
    expect(() => assemblePlugin({ repoRoot, outDir: tempDir('paqad-assemble-out-') })).toThrow(
      'dist is missing. Run pnpm build first.',
    );
    const unversioned = builtRepo();
    write(unversioned, 'package.json', '{');
    expect(() => assemblePlugin({ repoRoot: unversioned, outDir: tempDir('out-') })).toThrow(
      'plugin.json is at 1.99.4 but package.json is at no version. Run pnpm build first.',
    );
    expect(() => assemblePlugin({ repoRoot, outDir: repoRoot })).toThrow(
      'The output folder must not hold the repository.',
    );
    expect(() => assemblePlugin({ repoRoot, outDir: join(repoRoot, '..') })).toThrow(
      'The output folder must not hold the repository.',
    );
  });

  it('runs from the command line and prints a usage line with no folder', () => {
    let failed = false;
    try {
      execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' });
    } catch (error) {
      failed = true;
      expect(String((error as { stderr?: Buffer }).stderr)).toContain(
        'Usage: node scripts/assemble-plugin.mjs <output folder, a clone of Eliyce/paqad-claude-plugin>',
      );
    }
    expect(failed).toBe(true);
  });
});
