import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assemblePlugin,
  escapeControlBytes,
  NEVER_SHIPPED,
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
  write(root, 'SECURITY.md');
  write(root, 'assets/icon.png');
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
      [
        '.claude-plugin',
        'LICENSE',
        'README.md',
        'SECURITY.md',
        'assets',
        'dist',
        'package.json',
        'runtime',
      ].sort(),
    );
    expect(existsSync(join(outDir, 'assets/icon.png'))).toBe(true);
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

  it('AC-1 leaves source maps and OS junk out of the plugin tree', () => {
    const repoRoot = builtRepo();
    write(repoRoot, 'dist/cli/index.js.map');
    write(repoRoot, 'dist/index.js.map');
    write(repoRoot, 'runtime/templates/.DS_Store');
    write(repoRoot, 'runtime/templates/Thumbs.db');
    write(repoRoot, 'runtime/templates/desktop.ini');
    write(repoRoot, 'runtime/__MACOSX/stray.md');
    const outDir = join(tempDir('paqad-assemble-out-'), 'plugin');
    assemblePlugin({ repoRoot, outDir });
    expect(existsSync(join(outDir, 'dist/cli/index.js'))).toBe(true);
    expect(existsSync(join(outDir, 'dist/cli/index.js.map'))).toBe(false);
    expect(existsSync(join(outDir, 'dist/index.js.map'))).toBe(false);
    expect(existsSync(join(outDir, 'runtime/templates/.DS_Store'))).toBe(false);
    expect(existsSync(join(outDir, 'runtime/templates/Thumbs.db'))).toBe(false);
    expect(existsSync(join(outDir, 'runtime/templates/desktop.ini'))).toBe(false);
    expect(existsSync(join(outDir, 'runtime/__MACOSX'))).toBe(false);
  });

  it('refuses a repository without the listing icon', () => {
    const repoRoot = builtRepo();
    rmSync(join(repoRoot, 'assets'), { recursive: true });
    expect(() => assemblePlugin({ repoRoot, outDir: tempDir('paqad-assemble-out-') })).toThrow(
      'assets/icon.png is missing. Run pnpm build first.',
    );
  });

  it('AC-2 keeps every file of the build under the directory limit of 5 MiB with no OS junk', () => {
    let repoRoot = resolve('.');
    const versionOf = (rel: string) =>
      (JSON.parse(readFileSync(join(repoRoot, rel), 'utf8')) as { version: string }).version;
    const built =
      existsSync(join(repoRoot, 'dist/cli/index.js')) &&
      versionOf('package.json') === versionOf('.claude-plugin/plugin.json');
    if (!built) {
      repoRoot = builtRepo();
      write(repoRoot, 'dist/cli/index.js.map', 'x'.repeat(6 * 1024 * 1024));
      write(repoRoot, 'runtime/templates/.DS_Store');
    }
    const outDir = join(tempDir('paqad-assemble-real-'), 'plugin');
    assemblePlugin({ repoRoot, outDir });
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (NEVER_SHIPPED.has(entry.name) || entry.name.endsWith('.map')) offenders.push(full);
        if (entry.isDirectory()) walk(full);
        else if (statSync(full).size > 5 * 1024 * 1024) offenders.push(full);
      }
    };
    walk(outDir);
    expect(offenders).toEqual([]);
  });

  it('AC-17 AC-18: ships all 17 skills with their references and scripts, under 5,000 files and 200 MB', () => {
    let repoRoot = resolve('.');
    const versionOf = (rel: string) =>
      (JSON.parse(readFileSync(join(repoRoot, rel), 'utf8')) as { version: string }).version;
    const built =
      existsSync(join(repoRoot, 'dist/cli/index.js')) &&
      versionOf('package.json') === versionOf('.claude-plugin/plugin.json');
    if (!built) {
      repoRoot = builtRepo();
      rmSync(join(repoRoot, 'runtime'), { recursive: true });
      cpSync(resolve('runtime'), join(repoRoot, 'runtime'), { recursive: true });
    }
    const outDir = join(tempDir('paqad-assemble-skills-'), 'plugin');
    assemblePlugin({ repoRoot, outDir });
    const skills = join(outDir, 'runtime/claude-plugin/skills');
    expect(readdirSync(skills).sort()).toEqual(
      [
        'ask',
        'check-tickets',
        'dashboard',
        'decide-together',
        'discover',
        'get-connected',
        'ground-in-project',
        'join',
        'onboard',
        'plan-sprint',
        'post-tickets',
        'refine-ticket',
        'shape-idea',
        'size-work',
        'start',
        'understand-idea',
        'write-tickets',
      ].sort(),
    );
    for (const rel of [
      'ask/references/voice.md',
      'ask/scripts/check_onboarded.py',
      'discover/references/journey.md',
      'discover/assets/record-template.md',
      'write-tickets/assets/ticket-set.schema.json',
      'refine-ticket/scripts/check_readback.py',
      'start/SKILL.md',
    ]) {
      expect(existsSync(join(skills, rel)), rel).toBe(true);
    }
    let files = 0;
    let bytes = 0;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          files += 1;
          bytes += statSync(full).size;
        }
      }
    };
    walk(outDir);
    expect(files).toBeLessThan(5000);
    expect(bytes).toBeLessThan(200 * 1024 * 1024);
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

describe('scripts/assemble-plugin.mjs — what the directory reads', () => {
  function importsOf(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return importsOf(full);
      if (!/\.(m?js|tsx?)$/.test(entry.name)) return [];
      return readFileSync(full, 'utf8').includes('dist/plugin') ? [full] : [];
    });
  }

  it('AC-16: leaves dist/plugin out of the plugin tree and keeps the rest of dist', () => {
    const repoRoot = builtRepo();
    write(repoRoot, 'dist/plugin/manifest-build.js', 'export const x = 1;\n');
    write(repoRoot, 'dist/plugin/manifest-build.d.ts', 'export declare const x: number;\n');
    write(repoRoot, 'dist/plugins-other/keep.js', 'export const y = 1;\n');
    const outDir = join(tempDir('paqad-assemble-out-'), 'plugin');
    assemblePlugin({ repoRoot, outDir });
    expect(existsSync(join(outDir, 'dist/plugin'))).toBe(false);
    expect(existsSync(join(outDir, 'dist/cli/index.js'))).toBe(true);
    expect(existsSync(join(outDir, 'dist/plugins-other/keep.js'))).toBe(true);
    expect(importsOf(resolve('runtime'))).toEqual([]);
  });

  const RAW = Buffer.concat([
    Buffer.from('export const S = "'),
    Buffer.from([0x01, 0x02, 0x18, 0x1f, 0x0b, 0x0c]),
    Buffer.from('";\n'),
  ]);

  it('AC-17: rewrites raw control bytes in assembled .js as \\xNN text that still parses', async () => {
    const repoRoot = builtRepo();
    write(repoRoot, 'dist/chunk-raw.js', '');
    writeFileSync(join(repoRoot, 'dist/chunk-raw.js'), RAW);
    const clean = Buffer.from('export const T = "\\t tab and\\nnewline";\n\t// tab\r\n');
    writeFileSync(join(repoRoot, 'dist/chunk-clean.js'), clean);
    const outDir = join(tempDir('paqad-assemble-bytes-'), 'plugin');
    assemblePlugin({ repoRoot, outDir });
    const text = readFileSync(join(outDir, 'dist/chunk-raw.js'));
    expect(text.toString('latin1')).toBe('export const S = "\\x01\\x02\\x18\\x1f\\x0b\\x0c";\n');
    expect(readFileSync(join(outDir, 'dist/chunk-clean.js')).equals(clean)).toBe(true);
    expect(readFileSync(join(outDir, 'dist/cli/index.js'), 'utf8')).toBe('x');
    execFileSync(process.execPath, ['--check', join(outDir, 'dist/chunk-raw.js')]);
    const loaded = (await import(pathToFileURL(join(outDir, 'dist/chunk-raw.js')).href)) as {
      S: string;
    };
    expect([...loaded.S].map((char) => char.charCodeAt(0))).toEqual([
      0x01, 0x02, 0x18, 0x1f, 0x0b, 0x0c,
    ]);
    expect(escapeControlBytes(clean)).toBeNull();
  });

  it('AC-17: fails assembly when an escaped file no longer parses', () => {
    const repoRoot = builtRepo();
    writeFileSync(
      join(repoRoot, 'dist/broken.js'),
      Buffer.concat([Buffer.from('const a = 1;'), Buffer.from([0x01]), Buffer.from('\n')]),
    );
    expect(() =>
      assemblePlugin({ repoRoot, outDir: join(tempDir('paqad-assemble-broken-'), 'plugin') }),
    ).toThrow(/dist\/broken\.js does not parse after its control bytes were escaped/);
  });

  const built = existsSync(resolve('dist/cli/index.js'));

  it.skipIf(!built)(
    'AC-17: yaml loaded from the assembled dist still parses a document that starts with ---',
    async () => {
      const repoRoot = builtRepo();
      cpSync(resolve('dist'), join(repoRoot, 'dist'), { recursive: true });
      const outDir = join(tempDir('paqad-assemble-yaml-'), 'plugin');
      assemblePlugin({ repoRoot, outDir });
      symlinkSync(resolve('node_modules'), join(outDir, 'node_modules'), 'dir');
      const chunk = readdirSync(join(outDir, 'dist'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => join(outDir, 'dist', name))
        .find((path) => readFileSync(path, 'latin1').includes('var DOCUMENT = "\\x02"'));
      expect(chunk, 'the assembled chunk that bundles yaml').toBeDefined();
      expect(readFileSync(chunk!).some((byte) => byte === 0x02)).toBe(false);
      const loaded = (await import(pathToFileURL(chunk!).href)) as {
        require_dist: () => { parse: (text: string) => unknown };
      };
      expect(loaded.require_dist().parse('---\nname: paqad\nlist:\n  - a\n')).toEqual({
        name: 'paqad',
        list: ['a'],
      });
    },
  );
});
