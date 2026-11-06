import { execFileSync, spawnSync } from 'node:child_process';
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
  PLUGIN_ENGINES,
  PLUGIN_MARKETPLACE,
  PLUGIN_PACKAGE_KEYS,
  PLUGIN_REPO,
} from '../../../scripts/assemble-plugin.mjs';
import { checkPluginTree, runSelfImports } from '../../../scripts/check-plugin-tree.mjs';
import { maybeStartOptionalEngineInstall, OPTIONAL_ENGINES } from '@/core/optional-package.js';
import { __test as bootstrap } from '@/install/bootstrap.js';

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

function writeEngine(root: string, name: string, version: string): void {
  write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version }));
}

function builtRepo(version = '1.99.4', pluginVersion = version): string {
  const root = tempDir('paqad-assemble-repo-');
  write(
    root,
    'package.json',
    JSON.stringify({
      name: 'paqad-ai',
      version,
      description: 'fixture',
      type: 'module',
      license: 'MIT',
      bin: { 'paqad-ai': './dist/cli/index.js' },
      files: ['dist'],
      main: './dist/index.js',
      scripts: { postinstall: 'node x.mjs' },
      dependencies: { '@huggingface/transformers': '^4.3.1', openai: '^7.43.0' },
      devDependencies: { vitest: '^5.0.0' },
      exports: {
        '.': { import: './dist/index.js', types: './dist/index.d.ts' },
        './cli': { import: './dist/cli/index.js', types: './dist/cli/index.d.ts' },
        './rule-scripts': {
          import: './dist/rule-scripts/index.js',
          types: './dist/rule-scripts/index.d.ts',
        },
      },
    }),
  );
  writeEngine(root, '@huggingface/transformers', '4.3.1');
  writeEngine(root, 'openai', '7.43.0');
  write(
    root,
    '.claude-plugin/plugin.json',
    JSON.stringify({ name: 'paqad', version: pluginVersion }),
  );
  write(root, 'dist/cli/index.js');
  write(root, 'dist/index.js', 'export const root = 1;\n');
  write(root, 'dist/rule-scripts/index.js', 'export const rules = 1;\n');
  write(root, 'runtime/base/skills/fixture/scripts/run.mjs', '');
  write(root, 'runtime/scripts/install-engine.mjs', '');
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

  it('AC-17 AC-18 AC-50: ships all 18 skills with their references and scripts, under 5,000 files and 200 MB', () => {
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
        'decision-pause',
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

function builtHere(): boolean {
  const versionOf = (rel: string) =>
    (JSON.parse(readFileSync(resolve(rel), 'utf8')) as { version: string }).version;
  return (
    existsSync(resolve('dist/cli/index.js')) &&
    versionOf('package.json') === versionOf('.claude-plugin/plugin.json')
  );
}

describe('scripts/assemble-plugin.mjs — the generated package.json', () => {
  function assembledPackage(repoRoot: string): Record<string, unknown> {
    const outDir = join(tempDir('paqad-assemble-pkg-'), 'plugin');
    assemblePlugin({ repoRoot, outDir });
    return JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  }

  function leavesOutputAlone(repoRoot: string, message: string): void {
    const outDir = tempDir('paqad-assemble-kept-');
    write(outDir, 'old-file.txt', 'kept');
    expect(() => assemblePlugin({ repoRoot, outDir })).toThrow(message);
    expect(readdirSync(outDir)).toEqual(['old-file.txt']);
    expect(readFileSync(join(outDir, 'old-file.txt'), 'utf8')).toBe('kept');
  }

  it('AC-11: has exactly the kept keys in order, with exact engine versions and nothing from the npm package', () => {
    const pkg = assembledPackage(builtRepo());
    expect(Object.keys(pkg)).toEqual(PLUGIN_PACKAGE_KEYS);
    expect(PLUGIN_PACKAGE_KEYS).toEqual([
      'name',
      'version',
      'description',
      'type',
      'license',
      'exports',
      'paqadEngines',
    ]);
    expect(pkg).toMatchObject({
      name: 'paqad-ai',
      version: '1.99.4',
      description: 'fixture',
      license: 'MIT',
    });
    expect(pkg.type).toBe('module');
    expect(pkg.paqadEngines).toEqual({ '@huggingface/transformers': '4.3.1', openai: '7.43.0' });
    for (const key of ['scripts', 'devDependencies', 'files', 'bin', 'dependencies', 'main']) {
      expect(pkg[key], key).toBeUndefined();
    }
  });

  it('AC-11: type is module even when the repo leaves it out', () => {
    const repoRoot = builtRepo();
    const repoPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    delete repoPackage.type;
    write(repoRoot, 'package.json', JSON.stringify(repoPackage));
    expect(assembledPackage(repoRoot).type).toBe('module');
  });

  it('AC-11: refuses an engine whose installed version is not exact', () => {
    const repoRoot = builtRepo();
    writeEngine(repoRoot, '@huggingface/transformers', '4.3.1-beta.1');
    leavesOutputAlone(
      repoRoot,
      '@huggingface/transformers has version 4.3.1-beta.1, which is not an exact x.y.z version.',
    );
  });

  it.each(['@huggingface/transformers', 'openai'])(
    'AC-8: refuses a repo with %s missing and leaves the output folder as it was',
    (name) => {
      const repoRoot = builtRepo();
      rmSync(join(repoRoot, 'node_modules', name), { recursive: true });
      leavesOutputAlone(repoRoot, `${name} is not installed. Run pnpm install first.`);
    },
  );

  it('AC-8: reads the engines from the repo, not the working directory', () => {
    const repoRoot = builtRepo();
    writeEngine(repoRoot, 'openai', '1.2.3');
    expect((assembledPackage(repoRoot).paqadEngines as Record<string, string>).openai).toBe(
      '1.2.3',
    );
  });

  it.each([
    ['is absent from the repo', './dist/gone.js', null],
    ['sits outside the plugin tree', './src/index.js', 'src/index.js'],
    ['is left out of the tree', './dist/plugin/manifest-build.js', 'dist/plugin/manifest-build.js'],
  ])('AC-10: refuses an export whose target %s', (_label, target, present) => {
    const repoRoot = builtRepo();
    if (present) write(repoRoot, present);
    const repoPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    repoPackage.exports = { '.': { import: target, types: './dist/index.d.ts' } };
    write(repoRoot, 'package.json', JSON.stringify(repoPackage));
    leavesOutputAlone(repoRoot, `${target} in exports is missing from the assembled tree.`);
  });

  it('AC-10: a types target needs no file, because the condition is dropped first', () => {
    const repoRoot = builtRepo();
    expect(existsSync(join(repoRoot, 'dist/index.d.ts'))).toBe(false);
    expect(() => assembledPackage(repoRoot)).not.toThrow();
  });

  it('AC-10: refuses a repo with no exports to carry', () => {
    const repoRoot = builtRepo();
    const repoPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    delete repoPackage.exports;
    write(repoRoot, 'package.json', JSON.stringify(repoPackage));
    leavesOutputAlone(repoRoot, 'package.json has no exports to carry into the plugin.');
  });

  it('AC-12: PLUGIN_ENGINES equals OPTIONAL_ENGINES, so a drift cannot drop an engine', () => {
    expect([...PLUGIN_ENGINES]).toEqual([...OPTIONAL_ENGINES]);
  });

  it('AC-9: a shipped skill script imports both self-imports from the fixture tree, with no types condition', () => {
    const outDir = join(tempDir('paqad-assemble-self-'), 'plugin');
    assemblePlugin({ repoRoot: builtRepo(), outDir });
    expect(runSelfImports(outDir)).toContain('paqad-ai/rule-scripts');
    const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf8')) as {
      exports: unknown;
    };
    expect(JSON.stringify(pkg.exports)).not.toContain('types');
  });

  it.runIf(builtHere())(
    'AC-9: a shipped skill script imports both self-imports from the real tree',
    () => {
      const outDir = join(tempDir('paqad-assemble-self-real-'), 'plugin');
      assemblePlugin({ repoRoot: resolve('.'), outDir });
      expect(runSelfImports(outDir)).toContain('paqad-ai/rule-scripts');
      expect(existsSync(join(outDir, 'runtime/claude-plugin/mod/types/index.d.ts'))).toBe(true);
    },
    60_000,
  );

  it('AC-23: the install script is in the assembled tree and in the npm package', () => {
    const repoRoot = builtRepo();
    cpSync(resolve('runtime/scripts'), join(repoRoot, 'runtime/scripts'), { recursive: true });
    const outDir = join(tempDir('paqad-assemble-script-'), 'plugin');
    assemblePlugin({ repoRoot: builtHere() ? resolve('.') : repoRoot, outDir });
    expect(existsSync(join(outDir, 'runtime/scripts/install-engine.mjs'))).toBe(true);
    const pack = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(pack.status).toBe(0);
    const [manifest] = JSON.parse(pack.stdout) as { files: { path: string }[] }[];
    expect(manifest!.files.map((file) => file.path.replace(/\\/g, '/'))).toContain(
      'runtime/scripts/install-engine.mjs',
    );
  }, 60_000);

  it('AC-13: the bootstrap copy keeps the self-imports, the exact versions and the install script', () => {
    const repoRoot = builtRepo();
    const home = tempDir('paqad-assemble-copy-');
    const plugin = join(home, 'plugin');
    assemblePlugin({ repoRoot, outDir: plugin });
    const env = { CLAUDE_PLUGIN_DATA: join(home, 'data') } as NodeJS.ProcessEnv;
    const linked = bootstrap.ensureStablePluginRuntime(join(plugin, 'runtime'), env);
    expect(linked).toBe(join(home, 'data', 'runtime', 'runtime'));
    expect(runSelfImports(join(home, 'data', 'runtime'))).toContain('paqad-ai/rule-scripts');
    expect(existsSync(join(linked, 'scripts/install-engine.mjs'))).toBe(true);
    const started: string[][] = [];
    const outcome = maybeStartOptionalEngineInstall(
      { ...env, PAQAD_FRAMEWORK_HOME: linked },
      {
        resolve: () => null,
        now: () => 0,
        installScript: join(linked, 'scripts/install-engine.mjs'),
        startInstall: (specs) => started.push(specs),
      },
    );
    expect(outcome).toBe('started');
    expect(started).toEqual([['@huggingface/transformers@4.3.1', 'openai@7.43.0']]);
  });

  it('check-plugin-tree started through a linked folder still checks the tree', () => {
    const link = join(tempDir('paqad-check-tree-link-'), 'scripts');
    symlinkSync(resolve('scripts'), link, 'junction');
    const run = spawnSync(
      process.execPath,
      [join(link, 'check-plugin-tree.mjs'), join(link, 'no-such-tree')],
      { encoding: 'utf8' },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('no-such-tree');
  });

  it('AC-29: leaves every type file under dist out, at any depth, and keeps the mod types', () => {
    const repoRoot = builtRepo();
    write(repoRoot, 'dist/x.js');
    write(repoRoot, 'dist/x.d.ts');
    write(repoRoot, 'dist/nested/y.d.ts');
    const outDir = join(tempDir('paqad-assemble-types-'), 'plugin');
    assemblePlugin({ repoRoot, outDir });
    expect(existsSync(join(outDir, 'dist/x.js'))).toBe(true);
    expect(existsSync(join(outDir, 'dist/x.d.ts'))).toBe(false);
    expect(existsSync(join(outDir, 'dist/nested/y.d.ts'))).toBe(false);
    expect(existsSync(join(outDir, 'runtime/claude-plugin/mod/types/index.d.ts'))).toBe(true);
    expect(checkPluginTree(outDir)).toEqual([]);
    write(outDir, 'dist/nested/y.d.ts');
    expect(checkPluginTree(outDir)).toEqual(['dist/nested/y.d.ts is a type file under dist.']);
  });

  it('AC-9: the tree check names a failed self-import and a key outside the list', () => {
    const outDir = join(tempDir('paqad-assemble-bad-'), 'plugin');
    assemblePlugin({ repoRoot: builtRepo(), outDir });
    expect(checkPluginTree(outDir)).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    write(outDir, 'package.json', JSON.stringify({ name: pkg.name, type: pkg.type, scripts: {} }));
    const problems = checkPluginTree(outDir);
    expect(problems[0]).toContain('package.json has the keys name, type, scripts');
    expect(problems[1]).toContain('The self-imports failed.');
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

  it('AC-30: escapes 0x7F and leaves its neighbours 0x7E and 0x80 alone', () => {
    expect(escapeControlBytes(Buffer.from([0x61, 0x7f, 0x62]))!.toString('latin1')).toBe('a\\x7fb');
    expect(escapeControlBytes(Buffer.from([0x7e, 0x80]))).toBeNull();
    const mixed = escapeControlBytes(Buffer.from([0x7e, 0x7f, 0x80]))!;
    expect([...mixed]).toEqual([0x7e, ...Buffer.from('\\x7f'), 0x80]);
    const multibyte = Buffer.from('é€😀');
    expect(escapeControlBytes(multibyte)).toBeNull();
  });

  it('AC-30: a regular expression holding the byte matches the same input before and after', async () => {
    const source = Buffer.concat([
      Buffer.from('export const R = /[\\x00-'),
      Buffer.from([0x7f]),
      Buffer.from(']+/;\n'),
    ]);
    const before = tempDir('paqad-assemble-del-');
    write(before, 'raw.mjs');
    writeFileSync(join(before, 'raw.mjs'), source);
    write(before, 'escaped.mjs');
    writeFileSync(join(before, 'escaped.mjs'), escapeControlBytes(source)!);
    execFileSync(process.execPath, ['--check', join(before, 'escaped.mjs')]);
    const load = async (name: string) =>
      ((await import(pathToFileURL(join(before, name)).href)) as { R: RegExp }).R;
    const raw = await load('raw.mjs');
    const escaped = await load('escaped.mjs');
    for (const input of ['abc', '\x7f', '\x7e\x7f\x80', 'é', '\x80', '']) {
      expect(escaped.exec(input)?.[0]).toBe(raw.exec(input)?.[0]);
    }
    expect(escaped.test('\x7f')).toBe(true);
    expect(escaped.test('\x80')).toBe(false);
  });

  it('AC-2: the tree check passes a clean tree and names a file holding a raw byte', () => {
    const outDir = join(tempDir('paqad-assemble-check-'), 'plugin');
    assemblePlugin({ repoRoot: builtRepo(), outDir });
    expect(checkPluginTree(outDir)).toEqual([]);
    writeFileSync(join(outDir, 'dist/index.js'), Buffer.from([0x7f]));
    expect(checkPluginTree(outDir)).toContain('dist/index.js holds a raw control byte.');
  });

  it.runIf(builtHere())(
    'AC-2: the real tree holds no type file under dist, only the kept keys and no raw byte',
    () => {
      const outDir = join(tempDir('paqad-assemble-real-check-'), 'plugin');
      assemblePlugin({ repoRoot: resolve('.'), outDir });
      expect(checkPluginTree(outDir)).toEqual([]);
    },
    60_000,
  );

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
