import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectWiresLiveNpmHooks } from '@/install/plugin-migration.js';

import {
  hasLiveNpmHookLines,
  hookStandsDown,
  isTeamLauncherCommand,
  paqadHookScriptPath,
  pluginActiveMarkerRoot,
  pluginRootStandsDown,
  pluginStandsDownPassive,
  teamPluginRoot,
  writePluginActiveMarker,
} from '../../../runtime/hooks/lib/paqad-disabled.mjs';
import { __test as pluginSessionStart } from '../../../runtime/hooks/plugin-session-start.mjs';

const SID = 'ses-launcher';
const LAUNCHER = 'node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" capability-gate.mjs pre-mutation';
const LAUNCHER_WIN = 'node "C:\\work\\repo\\.paqad\\hook.mjs" agent-entry-gate.mjs';

let root: string;
let userDir: string;
let home: string;
let liveScript: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-launcher-standdown-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current');
  userDir = mkdtempSync(join(tmpdir(), 'paqad-launcher-claude-'));
  home = mkdtempSync(join(tmpdir(), 'paqad-launcher-home-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  liveScript = join(home, '.paqad-ai', 'current', 'hooks', 'capability-gate.mjs');
  mkdirSync(join(home, '.paqad-ai', 'current', 'hooks'), { recursive: true });
  writeFileSync(liveScript, '// hook\n');
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of [root, userDir, home]) rmSync(dir, { recursive: true, force: true });
});

function env(plugin = '/plugin'): NodeJS.ProcessEnv {
  return {
    CLAUDE_PROJECT_DIR: root,
    CLAUDE_CONFIG_DIR: userDir,
    CLAUDE_PLUGIN_ROOT: plugin,
  } as NodeJS.ProcessEnv;
}

function writeProjectSettings(commands: string[]): string {
  mkdirSync(join(root, '.claude'), { recursive: true });
  const path = join(root, '.claude', 'settings.json');
  writeFileSync(
    path,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Edit', hooks: commands.map((command) => ({ type: 'command', command })) },
        ],
      },
    }),
  );
  return path;
}

describe('launcher lines are never live npm hooks', () => {
  it('paqadHookScriptPath returns null for launcher commands in posix and windows form', () => {
    expect(paqadHookScriptPath(LAUNCHER)).toBeNull();
    expect(paqadHookScriptPath(LAUNCHER_WIN)).toBeNull();
    expect(isTeamLauncherCommand(LAUNCHER)).toBe(true);
    expect(isTeamLauncherCommand(LAUNCHER_WIN)).toBe(true);
    expect(isTeamLauncherCommand(`node "${liveScript}"`)).toBe(false);
    expect(isTeamLauncherCommand(undefined)).toBe(false);
    expect(paqadHookScriptPath(`node "${liveScript}" pre-mutation`)).toBe(liveScript);
  });

  it('settings holding only launcher lines never make the plugin stand down passively', () => {
    const path = writeProjectSettings([LAUNCHER]);
    expect(hasLiveNpmHookLines(path)).toBe(false);
    expect(pluginStandsDownPassive({ session_id: SID }, env())).toBe(false);
    expect(projectWiresLiveNpmHooks(root)).toBe(false);
  });

  it('a real absolute npm line still counts beside a launcher line', () => {
    const path = writeProjectSettings([LAUNCHER, `node "${liveScript}" pre-mutation`]);
    expect(hasLiveNpmHookLines(path)).toBe(true);
    expect(pluginStandsDownPassive({ session_id: SID }, env())).toBe(true);
    expect(projectWiresLiveNpmHooks(root)).toBe(true);
  });

  it('the dead-line cleanup keeps launcher lines', () => {
    const path = writeProjectSettings([LAUNCHER, 'node "/gone/.paqad-ai/current/hooks/x.mjs"']);
    pluginSessionStart.removeDeadNpmHookLines(path);
    const after = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(after.hooks.PreToolUse[0]?.hooks.map((hook) => hook.command)).toEqual([LAUNCHER]);
  });
});

describe('the launcher copy root is a live claim', () => {
  it('a turned-off installed plugin never reclaims a session the launcher copy claimed', () => {
    const copy = teamPluginRoot();
    expect(copy).toBe(join(home, '.paqad-ai', 'team-plugin'));
    mkdirSync(copy, { recursive: true });
    const installed = join(userDir, 'cache', 'paqad', '9.9.9');
    mkdirSync(installed, { recursive: true });
    mkdirSync(join(userDir, 'plugins'), { recursive: true });
    writeFileSync(
      join(userDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'paqad@eliyce': [{ installPath: installed }] } }),
    );
    const payload = { session_id: SID };
    writePluginActiveMarker(payload, env(copy));

    expect(pluginRootStandsDown(payload, env(installed))).toBe(true);
    expect(hookStandsDown(payload, env(installed))).toBe(true);
    expect(pluginActiveMarkerRoot(payload, env(installed))).toBe(copy);
    expect(pluginRootStandsDown(payload, env(copy))).toBe(false);
  });
});
