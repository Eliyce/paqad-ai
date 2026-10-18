// plugin-migration-tick.mjs — the SessionStart side of the npm → plugin migration (issue #648).
//
// The rollback counter must move on real Claude Code sessions, not on `update --silent` runs
// (which only happen when a newer npm version exists). Both SessionStart hooks (the npm
// silent-update.mjs and the plugin's plugin-session-start.mjs) call maybeSpawnMigrationTick. It
// holds NO state logic: it reads the machine migration file (and, for a `done` machine, the user's
// Claude settings), and only when there is work to do spawns a detached, stdio-ignored
// `paqad-ai plugin tick`, which runs the TypeScript state machine. It never prints, never blocks,
// and never throws. Dist-less and dependency-free, like the other runtime hook libs.

import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PLUGIN_ID = 'paqad@eliyce';

/** Parse a small JSON file, or null when absent/unreadable/malformed. */
function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The installed paqad package root: the framework link (`~/.paqad-ai/current`, or
 * PAQAD_FRAMEWORK_HOME) resolves to `<pkg>/runtime`, so the package is one level above it.
 * Returns null when the link cannot be resolved.
 */
export function frameworkPackageRoot(env = process.env) {
  const frameworkHome = env.PAQAD_FRAMEWORK_HOME || join(homedir(), '.paqad-ai', 'current');
  try {
    return dirname(realpathSync(frameworkHome));
  } catch {
    return null;
  }
}

/**
 * True when the machine migration state means a session has something to record: a move in flight
 * (`installed`), or a `done` machine whose user settings now turn the plugin off (B5). The settings
 * file is read only for a `done` machine.
 */
export function migrationTickDue(home = homedir()) {
  const record = readJson(join(home, '.paqad-ai', 'plugin-migration.json'));
  if (record?.state === 'installed') return true;
  if (record?.state !== 'done') return false;
  const settings = readJson(join(home, '.claude', 'settings.json'));
  return settings?.enabledPlugins?.[PLUGIN_ID] === false;
}

/**
 * Spawn `node <cli> plugin tick --source <source> [--session <id>]` detached when the migration
 * has work for this session. `cliPath` defaults to the installed package's CLI. Returns true when
 * a tick was spawned; every failure is swallowed.
 */
export function maybeSpawnMigrationTick({
  source,
  sessionId,
  cliPath,
  home = homedir(),
  env = process.env,
  spawn = nodeSpawn,
} = {}) {
  try {
    if (!migrationTickDue(home)) return false;
    let cli = cliPath;
    if (!cli) {
      const pkgRoot = frameworkPackageRoot(env);
      if (!pkgRoot) return false;
      cli = join(pkgRoot, 'dist', 'cli', 'index.js');
    }
    const args = [cli, 'plugin', 'tick', '--source', source];
    if (sessionId) args.push('--session', sessionId);
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    child.on?.('error', () => {}); // a failed spawn must never surface in the session
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
