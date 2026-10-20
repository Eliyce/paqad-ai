import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  hookStandsDown,
  installedPluginRoots,
  isPluginActiveForSession,
  pluginActiveMarkerDir,
  pluginActiveMarkerRoot,
  pluginRootStandsDown,
  writePluginActiveMarker,
} from '../../../runtime/hooks/lib/paqad-disabled.mjs';

const SID = 'ses-two-roots';
let project: string;
let rootA: string;
let rootB: string;
let scratch: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'paqad-two-roots-'));
  mkdirSync(join(project, '.paqad'), { recursive: true });
  writeFileSync(join(project, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current');
  scratch = mkdtempSync(join(tmpdir(), 'paqad-plugin-roots-'));
  rootA = join(scratch, 'cache', 'eliyce', 'paqad', '1.99.4');
  rootB = join(scratch, 'local-agent-mode-sessions', 'a', 'rpm', 'plugin_01');
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function env(root?: string): NodeJS.ProcessEnv {
  return {
    CLAUDE_PROJECT_DIR: project,
    CLAUDE_CONFIG_DIR: join(scratch, 'claude-config'),
    ...(root === undefined ? {} : { CLAUDE_PLUGIN_ROOT: root }),
  } as NodeJS.ProcessEnv;
}

const payload = { session_id: SID };

function markerPath(): string {
  return join(pluginActiveMarkerDir(project), SID);
}

function recordInstalled(...installPaths: string[]): void {
  const dir = join(scratch, 'claude-config', 'plugins');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'paqad@eliyce': installPaths.map((installPath) => ({ installPath })) },
    }),
  );
}

describe('a stale claim never keeps the live plugin root down', () => {
  it('the live root re-claims the session after an update left the old cache folder behind', () => {
    const rootNew = join(scratch, 'cache', 'eliyce', 'paqad', '1.99.5');
    mkdirSync(rootNew, { recursive: true });
    recordInstalled(rootNew);
    writePluginActiveMarker(payload, env(rootA));

    expect(pluginRootStandsDown(payload, env(rootNew))).toBe(false);
    expect(hookStandsDown(payload, env(rootNew))).toBe(false);
    expect(pluginActiveMarkerRoot(payload, env(rootNew))).toBe(rootNew);
    expect(pluginRootStandsDown(payload, env(rootA))).toBe(true);
  });

  it('a genuine second copy stands down while the claimed root is the installed one', () => {
    recordInstalled(rootA);
    writePluginActiveMarker(payload, env(rootA));

    expect(pluginRootStandsDown(payload, env(rootB))).toBe(true);
    expect(pluginActiveMarkerRoot(payload, env(rootB))).toBe(rootA);
    expect(pluginRootStandsDown(payload, env(rootA))).toBe(false);
  });

  it('a claimed claude.ai synced root that still exists stays live without an install record', () => {
    const synced = join(scratch, 'claude-config', 'plugins', 'synced', 'paqad');
    mkdirSync(synced, { recursive: true });
    recordInstalled(rootB);
    writePluginActiveMarker(payload, env(synced));

    expect(pluginRootStandsDown(payload, env(rootB))).toBe(true);
    rmSync(synced, { recursive: true, force: true });
    expect(pluginRootStandsDown(payload, env(rootB))).toBe(false);
  });

  it('an old marker without a root keeps the first chain running for every root', () => {
    recordInstalled(rootA);
    mkdirSync(pluginActiveMarkerDir(project), { recursive: true });
    writeFileSync(markerPath(), new Date().toISOString());
    for (const root of [rootA, rootB]) {
      expect(pluginRootStandsDown(payload, env(root))).toBe(false);
    }
  });

  it('reads the install record from CLAUDE_CONFIG_DIR and ignores records without paqad', () => {
    expect(installedPluginRoots(env())).toBeNull();
    recordInstalled();
    expect(installedPluginRoots(env())).toBeNull();
    recordInstalled(rootA);
    expect(installedPluginRoots(env())).toHaveLength(1);
    writeFileSync(
      join(scratch, 'claude-config', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ 'paqad@eliyce': { installPath: rootB } }),
    );
    expect(installedPluginRoots(env())).toHaveLength(1);
    writeFileSync(join(scratch, 'claude-config', 'plugins', 'installed_plugins.json'), 'null');
    expect(installedPluginRoots(env())).toBeNull();
  });
});

describe('only one plugin copy runs per session', () => {
  it('the first root to claim the session wins and the marker records it', () => {
    writePluginActiveMarker(payload, env(rootA));
    writePluginActiveMarker(payload, env(rootB));
    expect(pluginActiveMarkerRoot(payload, env(rootB))).toBe(rootA);
    expect(JSON.parse(readFileSync(markerPath(), 'utf8'))).toMatchObject({ root: rootA });
    expect(isPluginActiveForSession(payload, env(rootB))).toBe(true);
  });

  it('a hook reached from the second root stands down and the first root keeps running', () => {
    writePluginActiveMarker(payload, env(rootA));
    expect(pluginRootStandsDown(payload, env(rootB))).toBe(true);
    expect(hookStandsDown(payload, env(rootB))).toBe(true);
    expect(pluginRootStandsDown(payload, env(rootA))).toBe(false);
    expect(hookStandsDown(payload, env(rootA))).toBe(false);
  });

  it('the same root reached through a link or a trailing slash is the same copy', () => {
    writePluginActiveMarker(payload, env(rootA));
    const link = join(scratch, 'link-to-a');
    symlinkSync(rootA, link, 'junction');
    expect(pluginRootStandsDown(payload, env(link))).toBe(false);
    expect(pluginRootStandsDown(payload, env(`${rootA}/`))).toBe(false);
  });

  it('a marker written before roots were recorded claims for every root', () => {
    mkdirSync(pluginActiveMarkerDir(project), { recursive: true });
    writeFileSync(markerPath(), new Date().toISOString());
    for (const root of [rootA, rootB]) {
      expect(pluginRootStandsDown(payload, env(root))).toBe(false);
      expect(hookStandsDown(payload, env(root))).toBe(false);
    }
  });

  it('a marker with no root, or a claiming root gone from disk, never stands a hook down', () => {
    writePluginActiveMarker(payload, env());
    expect(pluginActiveMarkerRoot(payload, env(rootB))).toBeNull();
    expect(pluginRootStandsDown(payload, env(rootB))).toBe(false);
    rmSync(markerPath());
    writePluginActiveMarker(payload, env(rootA));
    rmSync(rootA, { recursive: true, force: true });
    expect(pluginRootStandsDown(payload, env(rootB))).toBe(false);
  });

  it('an npm-reached hook, an unclaimed session or a missing session id is never stood down by the root check', () => {
    expect(pluginRootStandsDown(payload, env(rootB))).toBe(false);
    writePluginActiveMarker(payload, env(rootA));
    expect(pluginRootStandsDown(payload, env())).toBe(false);
    expect(pluginRootStandsDown({}, env(rootB))).toBe(false);
    expect(pluginActiveMarkerRoot({}, env(rootB))).toBeNull();
    writeFileSync(markerPath(), 'null');
    expect(pluginActiveMarkerRoot(payload, env(rootB))).toBeNull();
  });
});
