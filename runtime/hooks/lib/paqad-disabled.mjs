import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['false', '0', 'no', 'off']);

export function isEnvDisabled(env = process.env) {
  const raw = env.PAQAD_DISABLED;
  return typeof raw === 'string' && ENV_TRUTHY.has(raw.trim().toLowerCase());
}

export function parseHookPayload(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return undefined;
  }
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function findProjectRootFromCwd(startDir) {
  let dir = startDir;
  for (;;) {
    try {
      if (statSync(join(dir, '.paqad')).isDirectory()) {
        return dir;
      }
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export function resolveProjectRoot(env = process.env, payload = undefined) {
  const cwd = payload && typeof payload.cwd === 'string' ? payload.cwd.trim() : '';
  if (cwd) {
    const found = findProjectRootFromCwd(cwd);
    if (found) {
      return found;
    }
  }
  return env.CLAUDE_PROJECT_DIR || env.PAQAD_PROJECT_ROOT || process.cwd();
}

export function isPaqadDisabled(projectRoot = resolveProjectRoot(), env = process.env) {
  if (isEnvDisabled(env)) {
    return true;
  }
  const resolved = resolvePaqadEnable(projectRoot, env);
  return resolved !== undefined && FALSY.has(resolved);
}

export function isProjectOnboarded(projectRoot = resolveProjectRoot()) {
  try {
    return statSync(join(projectRoot, '.paqad', 'framework-path.txt')).isFile();
  } catch {
    return false;
  }
}

export function pluginStandsDownUnonboarded(payload = undefined, env = process.env) {
  if (!env.CLAUDE_PLUGIN_ROOT) {
    return false;
  }
  return !isProjectOnboarded(resolveProjectRoot(env, payload));
}

export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function claudeSettingsPath(env = process.env) {
  return join(claudeDir(env), 'settings.json');
}

export function paqadHookScriptPath(command) {
  if (typeof command !== 'string' || !command.includes('paqad')) return null;
  const m = command.match(/"([^"]+\.mjs)"|(\S+\.mjs)/);
  const path = m ? (m[1] ?? m[2]) : null;
  return path && path.includes('paqad') ? path : null;
}

export function eachHookCommand(settings) {
  const out = [];
  const hooks = settings && typeof settings === 'object' ? settings.hooks : undefined;
  if (!hooks || typeof hooks !== 'object') return out;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, ei) => {
      const inner = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
      inner.forEach((hk, hi) => out.push({ event, ei, hi, command: hk && hk.command }));
    });
  }
  return out;
}

export function hasLiveNpmHookLines(settingsPath = claudeSettingsPath(process.env)) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return false;
  }
  return eachHookCommand(settings).some(({ command }) => {
    const script = paqadHookScriptPath(command);
    return script !== null && existsSync(script);
  });
}

export function projectClaudeSettingsPaths(projectRoot) {
  return [
    join(projectRoot, '.claude', 'settings.json'),
    join(projectRoot, '.claude', 'settings.local.json'),
  ];
}

export function anyLiveNpmHookLines(settingsPaths) {
  return settingsPaths.some((path) => hasLiveNpmHookLines(path));
}

export function pluginActiveMarkerDir(projectRoot) {
  return join(projectRoot, '.paqad', 'session', 'plugin-active.d');
}

export function sessionIdFrom(payload, env = process.env) {
  const fromPayload =
    payload && typeof payload.session_id === 'string' ? payload.session_id.trim() : '';
  if (fromPayload) return fromPayload;
  const fromEnv = env.CLAUDE_SESSION_ID;
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

export function isPluginActiveForSession(payload, env = process.env) {
  const sid = sessionIdFrom(payload, env);
  if (!sid) return false;
  const projectRoot = resolveProjectRoot(env, payload);
  try {
    return statSync(join(pluginActiveMarkerDir(projectRoot), sid)).isFile();
  } catch {
    return false;
  }
}

export function writePluginActiveMarker(payload, env = process.env) {
  const sid = sessionIdFrom(payload, env);
  if (!sid) return;
  const projectRoot = resolveProjectRoot(env, payload);
  const root = typeof env.CLAUDE_PLUGIN_ROOT === 'string' ? env.CLAUDE_PLUGIN_ROOT.trim() : '';
  const body = JSON.stringify({ at: new Date().toISOString(), ...(root ? { root } : {}) });
  try {
    const dir = pluginActiveMarkerDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, sid), body, { flag: 'wx' });
  } catch {
    return;
  }
}

export function pluginActiveMarkerRoot(payload, env = process.env) {
  const sid = sessionIdFrom(payload, env);
  if (!sid) return null;
  let parsed;
  try {
    const path = join(pluginActiveMarkerDir(resolveProjectRoot(env, payload)), sid);
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const root = parsed && typeof parsed === 'object' ? parsed.root : undefined;
  return typeof root === 'string' && root.trim() !== '' ? root : null;
}

function canonicalRoot(path) {
  let full;
  try {
    full = realpathSync.native(path);
  } catch {
    full = resolve(path);
  }
  const trimmed = full.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

const PAQAD_PLUGIN_ID = 'paqad@eliyce';

export function installedPluginRoots(env = process.env) {
  let parsed;
  try {
    parsed = JSON.parse(
      readFileSync(join(claudeDir(env), 'plugins', 'installed_plugins.json'), 'utf8'),
    );
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const plugins = parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : parsed;
  const value = plugins[PAQAD_PLUGIN_ID];
  const entries = Array.isArray(value) ? value : [value];
  const roots = entries
    .map((entry) => (entry && typeof entry === 'object' ? entry.installPath : undefined))
    .filter((path) => typeof path === 'string' && path.trim() !== '')
    .map((path) => canonicalRoot(path));
  return roots.length > 0 ? roots : null;
}

export function isSyncedPluginRoot(root) {
  const path = root.replaceAll('\\', '/');
  if (path.includes('/plugins/synced/')) return true;
  const sessions = path.indexOf('/Claude/local-agent-mode-sessions/');
  return sessions !== -1 && path.indexOf('/rpm/plugin_', sessions) !== -1;
}

function claimedRootIsLive(claimed, env) {
  if (isSyncedPluginRoot(claimed)) return true;
  const installed = installedPluginRoots(env);
  if (installed === null) return true;
  return installed.includes(canonicalRoot(claimed));
}

function reclaimPluginActiveMarker(payload, env, root) {
  const sid = sessionIdFrom(payload, env);
  try {
    writeFileSync(
      join(pluginActiveMarkerDir(resolveProjectRoot(env, payload)), sid),
      JSON.stringify({ at: new Date().toISOString(), root }),
    );
  } catch {
    return;
  }
}

export function pluginRootStandsDown(payload = undefined, env = process.env) {
  const mine = typeof env.CLAUDE_PLUGIN_ROOT === 'string' ? env.CLAUDE_PLUGIN_ROOT.trim() : '';
  if (!mine) return false;
  const claimed = pluginActiveMarkerRoot(payload, env);
  if (claimed === null || !existsSync(claimed)) return false;
  if (canonicalRoot(claimed) === canonicalRoot(mine)) return false;
  if (claimedRootIsLive(claimed, env)) return true;
  reclaimPluginActiveMarker(payload, env, mine);
  return false;
}

export function npmHookStepsAside(payload, env = process.env) {
  return !env.CLAUDE_PLUGIN_ROOT && isPluginActiveForSession(payload, env);
}

export function pluginStandsDownPassive(payload = undefined, env = process.env) {
  if (!env.CLAUDE_PLUGIN_ROOT) return false;
  if (isPluginActiveForSession(payload, env)) return false;
  const projectRoot = resolveProjectRoot(env, payload);
  if (!isProjectOnboarded(projectRoot)) return false;
  return anyLiveNpmHookLines([claudeSettingsPath(env), ...projectClaudeSettingsPaths(projectRoot)]);
}

export function hookStandsDown(payload = undefined, env = process.env) {
  return (
    npmHookStepsAside(payload, env) ||
    pluginStandsDownPassive(payload, env) ||
    pluginStandsDownUnonboarded(payload, env) ||
    pluginRootStandsDown(payload, env)
  );
}

function resolvePaqadEnable(projectRoot, env) {
  const raw = readLayeredKey(projectRoot, 'paqad_enable', 'PAQAD_ENABLE', env);
  return raw === undefined ? undefined : raw.trim().toLowerCase();
}

export function readLayeredKey(projectRoot, key, envName, env = process.env) {
  let value = readKeyFromConfigsDir(projectRoot, key);
  const local = readKeyFromFile(join(projectRoot, '.paqad', '.config'), key);
  if (local !== undefined) {
    value = local;
  }
  const fromEnv = env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    value = fromEnv.trim();
  }
  return value;
}

export function readFlooredMode(projectRoot, key, envName, order, def, env = process.env) {
  const norm = (raw) => {
    if (raw === undefined || raw === null) return undefined;
    const v = String(raw).trim().toLowerCase();
    return order.includes(v) ? v : undefined;
  };
  const team = norm(readKeyFromConfigsDir(projectRoot, key));
  const local = norm(readKeyFromFile(join(projectRoot, '.paqad', '.config'), key));
  const fromEnv = norm(env[envName]);
  let rank = order.indexOf(team ?? def);
  for (const raising of [local, fromEnv]) {
    if (raising !== undefined) {
      rank = Math.max(rank, order.indexOf(raising));
    }
  }
  return order[rank];
}

function readKeyFromFile(path, key) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  let value;
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`);
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) {
      value = m[1];
    }
  }
  if (value === undefined) {
    return undefined;
  }
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  } else {
    const hash = v.search(/\s#/);
    if (hash !== -1) {
      v = v.slice(0, hash).trim();
    }
  }
  return v;
}

function readKeyFromConfigsDir(projectRoot, key) {
  const dir = join(projectRoot, '.paqad', 'configs');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  let value;
  for (const name of names
    .filter((n) => /^\.config\..+/.test(n) && n !== '.config.example')
    .sort()) {
    const fromFile = readKeyFromFile(join(dir, name), key);
    if (fromFile !== undefined) {
      value = fromFile;
    }
  }
  return value;
}

export function isSchemaVersionError(err) {
  if (!err || typeof err !== 'object') return false;
  const code = err.code;
  const name = err.name;
  return code === 'SCHEMA_VERSION_INCOMPATIBLE' || name === 'SchemaVersionError';
}

export function appendHooksLog(projectRoot, line) {
  try {
    const dir = join(projectRoot, '.paqad', 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'hooks.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}
