import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
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
const { repointFrameworkLink: mjsRepointFrameworkLink } = mjsTest;

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
  const pluginRuntime = join(pluginRoot, 'runtime');
  mkdirSync(pluginRuntime, { recursive: true });
  const dataDir = join(dir, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  const current = join(dir, 'current');
  setup({ current, pluginRuntime });
  return {
    current,
    pluginRuntime,
    stable: join(dataDir, 'runtime'),
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

  it('ensureStablePluginRuntime is idempotent once the stable link already points at the runtime', () => {
    const dataDir = join(root, 'data');
    const pluginRuntime = join(root, 'pr2', 'runtime');
    mkdirSync(pluginRuntime, { recursive: true });
    const env = { CLAUDE_PLUGIN_DATA: dataDir } as NodeJS.ProcessEnv;
    const first = ensureStablePluginRuntime(pluginRuntime, env);
    expect(targetOf(first)).toBe(pluginRuntime);
    // Second call: the stable link is already current, so it returns the same path unchanged.
    expect(ensureStablePluginRuntime(pluginRuntime, env)).toBe(first);
    expect(targetOf(first)).toBe(pluginRuntime);
  });

  it('ensureStablePluginRuntime fails open to the plugin runtime when the stable link cannot be written', () => {
    const notADir = join(root, 'afile');
    writeFileSync(notADir, 'x');
    const pluginRuntime = join(root, 'pr-fail', 'runtime');
    mkdirSync(pluginRuntime, { recursive: true });
    // CLAUDE_PLUGIN_DATA sits under a FILE, so mkdirSync(dirname(stable)) throws → catch.
    expect(
      ensureStablePluginRuntime(pluginRuntime, {
        CLAUDE_PLUGIN_DATA: join(notADir, 'data'),
      } as NodeJS.ProcessEnv),
    ).toBe(pluginRuntime);
  });

  it('ensureStablePluginRuntime leaves a real directory placed at the stable path alone', () => {
    const dataDir = join(root, 'data3');
    const stable = join(dataDir, 'runtime');
    mkdirSync(stable, { recursive: true });
    const pluginRuntime = join(root, 'pr3', 'runtime');
    mkdirSync(pluginRuntime, { recursive: true });
    expect(
      ensureStablePluginRuntime(pluginRuntime, {
        CLAUDE_PLUGIN_DATA: dataDir,
      } as NodeJS.ProcessEnv),
    ).toBe(stable);
    expect(lstatSync(stable).isDirectory()).toBe(true);
    expect(lstatSync(stable).isSymbolicLink()).toBe(false);
  });
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
    expect(targetOf(s.stable)).toBe(s.pluginRuntime);
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
