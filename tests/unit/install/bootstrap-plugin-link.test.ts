import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __test as bootstrapTest } from '@/install/bootstrap';
// The dist-less runtime hook: its `repointFrameworkLink` is the original the TS mirror follows.
import { __test as mjsTest } from '../../../runtime/hooks/plugin-session-start.mjs';

const { ensureFrameworkSymlink, isPluginRuntime, repointFrameworkLinkPluginAware } = bootstrapTest;
const { ensureStablePluginRuntime, stableRuntimeHome, isNpmRuntime, isPluginCacheRuntime } =
  bootstrapTest;
const {
  repointFrameworkLink: mjsRepointFrameworkLink,
  ensureStablePluginRuntime: mjsEnsureStablePluginRuntime,
} = mjsTest;

function makePluginRoot(pluginRoot: string, version: string): string {
  const pluginRuntime = join(pluginRoot, 'runtime');
  mkdirSync(join(pluginRuntime, 'hooks'), { recursive: true });
  mkdirSync(join(pluginRoot, 'dist', 'cli'), { recursive: true });
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ name: 'paqad-ai', version }));
  writeFileSync(join(pluginRoot, 'dist', 'cli', 'index.js'), `export const v = '${version}';\n`);
  writeFileSync(join(pluginRuntime, 'hooks', 'hook.mjs'), `// ${version}\n`);
  return pluginRuntime;
}

function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-bootstrap-link-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Resolve a symlink's recorded target, or null when the path is not a symlink / is absent. */
function targetOf(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

/**
 * Build a fresh scenario: a plugin runtime, a stable-data dir, and a `current` link in one of
 * several starting states. Returns the paths plus the plugin-mode env both implementations read.
 */
interface Scenario {
  current: string;
  pluginRuntime: string;
  copyRoot: string;
  stable: string;
  env: NodeJS.ProcessEnv;
}

function scenario(
  name: string,
  setup: (s: { current: string; pluginRuntime: string }) => void,
): Scenario {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const pluginRoot = join(dir, 'plugin-cache', 'paqad-1.0.0');
  const pluginRuntime = makePluginRoot(pluginRoot, '1.0.0');
  const dataDir = join(dir, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  const current = join(dir, 'current');
  setup({ current, pluginRuntime });
  return {
    current,
    pluginRuntime,
    copyRoot: join(dataDir, 'runtime'),
    stable: join(dataDir, 'runtime', 'runtime'),
    env: {
      PAQAD_FRAMEWORK_HOME: current,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PLUGIN_DATA: dataDir,
    } as NodeJS.ProcessEnv,
  };
}

describe('isPluginRuntime', () => {
  it('is true only when CLAUDE_PLUGIN_ROOT is set', () => {
    expect(isPluginRuntime({ CLAUDE_PLUGIN_ROOT: '/x' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPluginRuntime({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isPluginRuntime({ CLAUDE_PLUGIN_ROOT: '' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('stable-runtime helpers (mirrors of the .mjs)', () => {
  it('isNpmRuntime / isPluginCacheRuntime classify by path', () => {
    expect(isNpmRuntime('/a/node_modules/paqad-ai/runtime')).toBe(true);
    expect(isNpmRuntime('/a/plugins/x/runtime')).toBe(false);
    expect(isPluginCacheRuntime('/a/plugins/x/runtime')).toBe(true);
    expect(isPluginCacheRuntime('/a/node_modules/x/runtime')).toBe(false);
  });

  it('stableRuntimeHome is CLAUDE_PLUGIN_DATA/runtime, or null when unset', () => {
    expect(stableRuntimeHome({ CLAUDE_PLUGIN_DATA: '/data' } as NodeJS.ProcessEnv)).toBe(
      join('/data', 'runtime'),
    );
    expect(stableRuntimeHome({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('ensureStablePluginRuntime returns the plugin runtime itself when CLAUDE_PLUGIN_DATA is unset', () => {
    const pluginRuntime = join(root, 'pr', 'runtime');
    mkdirSync(pluginRuntime, { recursive: true });
    expect(ensureStablePluginRuntime(pluginRuntime, {} as NodeJS.ProcessEnv)).toBe(pluginRuntime);
  });

  it('ensureStablePluginRuntime returns the plugin runtime when the plugin has no readable version', () => {
    const pluginRuntime = join(root, 'pr-noversion', 'runtime');
    mkdirSync(pluginRuntime, { recursive: true });
    expect(
      ensureStablePluginRuntime(pluginRuntime, {
        CLAUDE_PLUGIN_DATA: join(root, 'data-noversion'),
      } as NodeJS.ProcessEnv),
    ).toBe(pluginRuntime);
    expect(existsSync(join(root, 'data-noversion', 'runtime'))).toBe(false);
  });

  it('ensureStablePluginRuntime fails open to the plugin runtime when the copy cannot be written', () => {
    const notADir = join(root, 'afile');
    writeFileSync(notADir, 'x');
    const pluginRuntime = makePluginRoot(join(root, 'pr-fail'), '1.0.0');
    // CLAUDE_PLUGIN_DATA sits under a FILE, so mkdirSync(dirname(stable)) throws → catch.
    expect(
      ensureStablePluginRuntime(pluginRuntime, {
        CLAUDE_PLUGIN_DATA: join(notADir, 'data'),
      } as NodeJS.ProcessEnv),
    ).toBe(pluginRuntime);
  });
});

const implementations = [
  { name: 'bootstrap.ts', ensure: ensureStablePluginRuntime },
  { name: 'plugin-session-start.mjs', ensure: mjsEnsureStablePluginRuntime },
] as const;

for (const impl of implementations) {
  describe(`runtime copy in ${impl.name}`, () => {
    function setup(name: string, version = '1.0.0') {
      const dir = join(root, `${impl.name}-${name}`);
      const dataDir = join(dir, 'plugins', 'data', 'paqad-eliyce');
      const pluginRoot = join(dir, 'plugins', 'cache', 'eliyce', 'paqad', version);
      const pluginRuntime = makePluginRoot(pluginRoot, version);
      const env = { CLAUDE_PLUGIN_DATA: dataDir } as NodeJS.ProcessEnv;
      return { dir, dataDir, pluginRoot, pluginRuntime, env, copyRoot: join(dataDir, 'runtime') };
    }

    it('makes a real copy of package.json, dist and runtime plus a version file', () => {
      const s = setup('fresh');
      const linked = impl.ensure(s.pluginRuntime, s.env);
      expect(linked).toBe(join(s.copyRoot, 'runtime'));
      expect(lstatSync(s.copyRoot).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(s.copyRoot, 'version'), 'utf8').trim()).toBe('1.0.0');
      expect(existsSync(join(s.copyRoot, 'package.json'))).toBe(true);
      expect(existsSync(join(s.copyRoot, 'dist', 'cli', 'index.js'))).toBe(true);
      expect(existsSync(join(s.copyRoot, 'runtime', 'hooks', 'hook.mjs'))).toBe(true);
      expect(readdirSync(s.dataDir).sort()).toEqual(['runtime']);
    });

    it('changes no file when the version file already matches the running plugin', () => {
      const s = setup('same-version');
      impl.ensure(s.pluginRuntime, s.env);
      const before = listTree(s.copyRoot).map((file) => [file, statSync(file).mtimeMs]);
      const inode = statSync(s.copyRoot).ino;
      impl.ensure(s.pluginRuntime, s.env);
      expect(listTree(s.copyRoot).map((file) => [file, statSync(file).mtimeMs])).toEqual(before);
      expect(statSync(s.copyRoot).ino).toBe(inode);
    });

    it('refreshes the copy on a version change and survives the old cache folder being deleted', () => {
      const a = setup('bump', '1.0.0');
      impl.ensure(a.pluginRuntime, a.env);
      const pluginRootB = join(a.dir, 'plugins', 'cache', 'eliyce', 'paqad', '1.1.0');
      const pluginRuntimeB = makePluginRoot(pluginRootB, '1.1.0');
      const linked = impl.ensure(pluginRuntimeB, a.env);
      rmSync(a.pluginRoot, { recursive: true, force: true });
      expect(readFileSync(join(a.copyRoot, 'version'), 'utf8').trim()).toBe('1.1.0');
      expect(readFileSync(join(a.copyRoot, 'dist', 'cli', 'index.js'), 'utf8')).toContain('1.1.0');
      expect(existsSync(linked)).toBe(true);
      expect(readdirSync(a.dataDir).sort()).toEqual(['runtime']);
    });

    it('replaces an old runtime symlink with a real folder', () => {
      const s = setup('old-symlink');
      mkdirSync(s.dataDir, { recursive: true });
      symlinkSync(s.pluginRuntime, s.copyRoot);
      impl.ensure(s.pluginRuntime, s.env);
      expect(lstatSync(s.copyRoot).isSymbolicLink()).toBe(false);
      expect(lstatSync(s.copyRoot).isDirectory()).toBe(true);
      expect(existsSync(join(s.pluginRuntime, 'hooks', 'hook.mjs'))).toBe(true);
    });

    it('replaces a real folder that has no version file', () => {
      const s = setup('stale-folder');
      mkdirSync(join(s.copyRoot, 'leftover'), { recursive: true });
      impl.ensure(s.pluginRuntime, s.env);
      expect(existsSync(join(s.copyRoot, 'leftover'))).toBe(false);
      expect(readFileSync(join(s.copyRoot, 'version'), 'utf8').trim()).toBe('1.0.0');
    });
  });
}

describe('framework link after a plugin update, both implementations', () => {
  const repointers = [
    {
      name: 'bootstrap.ts',
      repoint: (runtime: string, home: string, env: NodeJS.ProcessEnv) =>
        repointFrameworkLinkPluginAware(runtime, home, env),
    },
    {
      name: 'plugin-session-start.mjs',
      repoint: (runtime: string, _home: string, env: NodeJS.ProcessEnv) =>
        mjsRepointFrameworkLink(runtime, env),
    },
  ];

  for (const r of repointers) {
    it(`${r.name} keeps current on the data copy holding version B after cache A is deleted`, () => {
      const dir = join(root, `update-${r.name}`);
      const dataDir = join(dir, 'plugins', 'data', 'paqad-eliyce');
      const home = join(dir, 'current');
      const env = { CLAUDE_PLUGIN_DATA: dataDir, PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv;
      const rootA = join(dir, 'plugins', 'cache', 'eliyce', 'paqad', '1.0.0');
      r.repoint(makePluginRoot(rootA, '1.0.0'), home, env);
      const rootB = join(dir, 'plugins', 'cache', 'eliyce', 'paqad', '1.1.0');
      r.repoint(makePluginRoot(rootB, '1.1.0'), home, env);
      rmSync(rootA, { recursive: true, force: true });

      expect(targetOf(home)).toBe(join(dataDir, 'runtime', 'runtime'));
      expect(targetOf(home)).not.toContain(join('plugins', 'cache'));
      expect(realpathSync(home)).toBe(realpathSync(join(dataDir, 'runtime', 'runtime')));
      expect(readFileSync(join(dataDir, 'runtime', 'version'), 'utf8').trim()).toBe('1.1.0');
    });

    it(`${r.name} moves a link left on the old data runtime folder onto the copy`, () => {
      const dir = join(root, `old-stable-${r.name}`);
      const dataDir = join(dir, 'data');
      const home = join(dir, 'current');
      const env = { CLAUDE_PLUGIN_DATA: dataDir, PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv;
      const pluginRuntime = makePluginRoot(join(dir, 'cache', '1.0.0'), '1.0.0');
      mkdirSync(dataDir, { recursive: true });
      symlinkSync(pluginRuntime, join(dataDir, 'runtime'));
      symlinkSync(join(dataDir, 'runtime'), home);
      r.repoint(pluginRuntime, home, env);
      expect(targetOf(home)).toBe(join(dataDir, 'runtime', 'runtime'));
    });
  }
});

describe('repointFrameworkLinkPluginAware (issue #641, Gap 1)', () => {
  it('leaves the link untouched when it already points at the stable location', () => {
    const s = scenario('already-stable', () => {
      /* link created below after stable exists */
    });
    // Establish the stable link, then point current at it; a second repoint is a no-op.
    const stable = ensureStablePluginRuntime(s.pluginRuntime, s.env);
    symlinkSync(stable, s.current);
    repointFrameworkLinkPluginAware(s.pluginRuntime, s.current, s.env);
    expect(targetOf(s.current)).toBe(stable);
  });

  it('fails open (no throw, no link) when the re-point itself cannot be written', () => {
    const notADir = join(root, 'bfile');
    writeFileSync(notADir, 'x');
    const current = join(notADir, 'current'); // parent is a FILE → mkdir/symlink throws
    const pluginRuntime = join(root, 'pr-repoint-fail', 'runtime');
    mkdirSync(pluginRuntime, { recursive: true });
    expect(() =>
      repointFrameworkLinkPluginAware(pluginRuntime, current, {
        CLAUDE_PLUGIN_DATA: join(root, 'ok-data'),
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(targetOf(current)).toBeNull();
  });

  it('leaves a link that resolves to a working npm install untouched (FR-1)', () => {
    const npmRuntime = join(root, 'npm', 'node_modules', 'paqad-ai', 'runtime');
    mkdirSync(npmRuntime, { recursive: true });
    const s = scenario('npm-working', ({ current }) => {
      symlinkSync(npmRuntime, current);
    });
    repointFrameworkLinkPluginAware(s.pluginRuntime, s.current, s.env);
    expect(targetOf(s.current)).toBe(npmRuntime);
  });

  it('re-points a dangling link at the stable plugin-data runtime (FR-2)', () => {
    const s = scenario('dangling', ({ current }) => {
      symlinkSync(join(root, 'gone', 'runtime'), current);
    });
    repointFrameworkLinkPluginAware(s.pluginRuntime, s.current, s.env);
    expect(targetOf(s.current)).toBe(s.stable);
    expect(readFileSync(join(s.copyRoot, 'version'), 'utf8').trim()).toBe('1.0.0');
  });

  it('fills a missing link, pointing at the stable plugin-data runtime (FR-2)', () => {
    const s = scenario('missing', () => {
      /* no link created */
    });
    repointFrameworkLinkPluginAware(s.pluginRuntime, s.current, s.env);
    expect(targetOf(s.current)).toBe(s.stable);
  });

  it('refreshes its own earlier plugin-cache takeover to the stable runtime', () => {
    const olderCache = join(root, 'older', 'plugins', 'paqad-0.9.0', 'runtime');
    mkdirSync(olderCache, { recursive: true });
    const s = scenario('cache-takeover', ({ current }) => {
      symlinkSync(olderCache, current);
    });
    repointFrameworkLinkPluginAware(s.pluginRuntime, s.current, s.env);
    expect(targetOf(s.current)).toBe(s.stable);
  });

  it('never replaces a real directory', () => {
    const s = scenario('real-dir', ({ current }) => {
      mkdirSync(current, { recursive: true });
    });
    repointFrameworkLinkPluginAware(s.pluginRuntime, s.current, s.env);
    expect(lstatSync(s.current).isDirectory()).toBe(true);
    expect(lstatSync(s.current).isSymbolicLink()).toBe(false);
  });

  it('leaves an unknown working directory target alone', () => {
    const unknown = join(root, 'unknown-tool', 'runtime');
    mkdirSync(unknown, { recursive: true });
    const s = scenario('unknown-working', ({ current }) => {
      symlinkSync(unknown, current);
    });
    repointFrameworkLinkPluginAware(s.pluginRuntime, s.current, s.env);
    expect(targetOf(s.current)).toBe(unknown);
  });
});

describe('ensureFrameworkSymlink npm-install path is unchanged (issue #641, FR-3 / INV-1)', () => {
  it('points the link at the running npm runtime when not under the plugin', () => {
    const npmRuntime = join(root, 'npm', 'node_modules', 'paqad-ai', 'runtime');
    mkdirSync(npmRuntime, { recursive: true });
    const current = join(root, 'npm-current');
    // No CLAUDE_PLUGIN_ROOT → the plugin branch is never taken.
    ensureFrameworkSymlink(npmRuntime, current, {} as NodeJS.ProcessEnv);
    expect(targetOf(current)).toBe(npmRuntime);
  });

  it('under the plugin, the npm path is not used — a working npm link is preserved', () => {
    const npmRuntime = join(root, 'npm2', 'node_modules', 'paqad-ai', 'runtime');
    mkdirSync(npmRuntime, { recursive: true });
    const s = scenario('ensure-plugin', ({ current }) => {
      symlinkSync(npmRuntime, current);
    });
    // runtimeRoot here is the plugin runtime; isPluginRuntime(env) is true via CLAUDE_PLUGIN_ROOT.
    ensureFrameworkSymlink(s.pluginRuntime, s.current, s.env);
    expect(targetOf(s.current)).toBe(npmRuntime);
  });
});

// INV-4: the TS mirror and the dist-less `.mjs` original must make the identical link decision.
describe('TS/.mjs consistency (issue #641, INV-4)', () => {
  const cases: { name: string; setup: (s: { current: string; pluginRuntime: string }) => void }[] =
    [
      {
        name: 'working-npm',
        setup: ({ current }) => {
          const npmRuntime = join(root, 'shared-npm', 'node_modules', 'paqad-ai', 'runtime');
          mkdirSync(npmRuntime, { recursive: true });
          symlinkSync(npmRuntime, current);
        },
      },
      {
        name: 'dangling',
        setup: ({ current }) => {
          symlinkSync(join(root, 'shared-gone', 'runtime'), current);
        },
      },
      {
        name: 'missing',
        setup: () => {
          /* none */
        },
      },
      {
        name: 'unknown-working',
        setup: ({ current }) => {
          const unknown = join(root, 'shared-unknown', 'runtime');
          mkdirSync(unknown, { recursive: true });
          symlinkSync(unknown, current);
        },
      },
    ];

  for (const c of cases) {
    it(`agrees on the "${c.name}" case`, () => {
      // Two independent, identically-seeded fixtures: one driven by the TS mirror, one by the .mjs.
      const tsScenario = scenario(`ts-${c.name}`, c.setup);
      repointFrameworkLinkPluginAware(tsScenario.pluginRuntime, tsScenario.current, tsScenario.env);
      const tsTarget = targetOf(tsScenario.current);

      const mjsScenario = scenario(`mjs-${c.name}`, c.setup);
      // The .mjs reads the link path from PAQAD_FRAMEWORK_HOME in env.
      mjsRepointFrameworkLink(mjsScenario.pluginRuntime, mjsScenario.env);
      const mjsTarget = targetOf(mjsScenario.current);

      // Both must agree on whether a re-point happened and (when it did) which category it chose:
      // same stable vs same preserved target. Compare by category since the two scenarios use
      // different temp roots.
      const classify = (target: string | null, s: Scenario): string => {
        if (target === null) return 'none';
        if (target === s.stable) return 'stable';
        if (target.includes('node_modules')) return 'npm-preserved';
        if (target.includes('shared-unknown') || target.includes('unknown'))
          return 'unknown-preserved';
        return `other:${target}`;
      };
      expect(classify(tsTarget, tsScenario)).toBe(classify(mjsTarget, mjsScenario));
    });
  }
});
