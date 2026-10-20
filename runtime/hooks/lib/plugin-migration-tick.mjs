import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PLUGIN_ID = 'paqad@eliyce';

function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function frameworkPackageRoot(env = process.env) {
  const frameworkHome = env.PAQAD_FRAMEWORK_HOME || join(homedir(), '.paqad-ai', 'current');
  try {
    return dirname(realpathSync(frameworkHome));
  } catch {
    return null;
  }
}

export function migrationTickDue(home = homedir()) {
  const record = readJson(join(home, '.paqad-ai', 'plugin-migration.json'));
  if (record?.state === 'installed') return true;
  if (record?.state !== 'done') return false;
  const settings = readJson(join(home, '.claude', 'settings.json'));
  return settings?.enabledPlugins?.[PLUGIN_ID] === false;
}

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
    child.on?.('error', () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
