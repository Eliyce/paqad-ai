#!/usr/bin/env node

import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import {
  anyLiveNpmHookLines,
  claudeDir,
  claudeSettingsPath,
  hasLiveNpmHookLines,
  isProjectOnboarded,
  paqadHookScriptPath,
  parseHookPayload,
  pluginRootStandsDown,
  pluginStandsDownPassive,
  projectClaudeSettingsPaths,
  resolveProjectRoot,
  sessionIdFrom,
  writePluginActiveMarker,
} from './lib/paqad-disabled.mjs';
import { isDirectEntry } from './lib/direct-entry.mjs';
import { maybeSpawnMigrationTick } from './lib/plugin-migration-tick.mjs';

function frameworkHome(env = process.env) {
  return env.PAQAD_FRAMEWORK_HOME || join(homedir(), '.paqad-ai', 'current');
}

function symlinkType() {
  return process.platform === 'win32' ? 'junction' : undefined;
}

function readPackageVersion(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = String(a)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function linkTarget(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

function isNpmRuntime(target) {
  return typeof target === 'string' && target.includes('node_modules');
}

function isPluginCacheRuntime(target) {
  return (
    typeof target === 'string' && (target.includes('/plugins/') || target.includes('\\plugins\\'))
  );
}

function stableRuntimeHome(env = process.env) {
  const data = env.CLAUDE_PLUGIN_DATA;
  return typeof data === 'string' && data.length > 0 ? join(data, 'runtime') : null;
}

const RUNTIME_COPY_PARTS = ['package.json', 'dist', 'runtime'];
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_MAX_ATTEMPTS = 5;

function renameWithRetrySync(from, to, remove) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const retryable = process.platform === 'win32' && RENAME_RETRY_CODES.has(error?.code ?? '');
      if (attempt >= RENAME_MAX_ATTEMPTS || !retryable) {
        remove(from);
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** (attempt - 1));
    }
  }
}

function runtimeCopyVersion(copyRoot) {
  const st = lstatSafe(copyRoot);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) {
    return null;
  }
  try {
    return readFileSync(join(copyRoot, 'version'), 'utf8').trim();
  } catch {
    return null;
  }
}

function removeTree(path) {
  rmSync(path, { recursive: true, force: true });
}

function removeTreeQuietly(path) {
  try {
    removeTree(path);
  } catch {
    return;
  }
}

function replaceRuntimeCopy(staging, copyRoot) {
  const st = lstatSafe(copyRoot);
  let retired = null;
  if (st && st.isSymbolicLink()) {
    rmSync(copyRoot, { force: true, recursive: false });
  } else if (st) {
    retired = `${copyRoot}.old-${process.pid}`;
    removeTree(retired);
    renameWithRetrySync(copyRoot, retired, () => undefined);
  }
  renameWithRetrySync(staging, copyRoot, removeTreeQuietly);
  if (retired) {
    removeTreeQuietly(retired);
  }
}

function ensureStablePluginRuntime(pluginRuntime, env = process.env) {
  const copyRoot = stableRuntimeHome(env);
  if (!copyRoot) {
    return pluginRuntime;
  }
  const pluginRoot = dirname(pluginRuntime);
  const linked = join(copyRoot, 'runtime');
  const staging = `${copyRoot}.tmp-${process.pid}`;
  try {
    const version = readPackageVersion(pluginRoot);
    if (!version) {
      return pluginRuntime;
    }
    if (runtimeCopyVersion(copyRoot) === version && existsSync(linked)) {
      return linked;
    }
    removeTree(staging);
    mkdirSync(staging, { recursive: true });
    for (const part of RUNTIME_COPY_PARTS) {
      const from = join(pluginRoot, part);
      if (existsSync(from)) {
        cpSync(from, join(staging, part), { recursive: true });
      }
    }
    writeFileSync(join(staging, 'version'), `${version}\n`, 'utf8');
    replaceRuntimeCopy(staging, copyRoot);
    return linked;
  } catch {
    removeTreeQuietly(staging);
    return pluginRuntime;
  }
}

function repointFrameworkLink(pluginRuntime, env = process.env) {
  const home = frameworkHome(env);
  const stat = lstatSafe(home);

  if (stat && stat.isDirectory() && !stat.isSymbolicLink()) {
    return;
  }

  const stable = ensureStablePluginRuntime(pluginRuntime, env);

  if (stat && stat.isSymbolicLink()) {
    const target = linkTarget(home);
    if (target) {
      if (target === stable) {
        return;
      }
      const targetStat = lstatSafe(target);
      if (targetStat && target !== stableRuntimeHome(env)) {
        if (isNpmRuntime(target)) {
          return;
        }
        if (!isPluginCacheRuntime(target) && target !== pluginRuntime) {
          return;
        }
      }
    }
  }

  try {
    mkdirSync(dirname(home), { recursive: true });
    rmSync(home, { force: true, recursive: false });
    symlinkSync(stable, home, symlinkType());
  } catch {}
}

function ensureBinOnPath(pluginRuntime, env = process.env) {
  const binDir = join(pluginRuntime, 'claude-plugin', 'bin');
  if (process.platform !== 'win32') {
    try {
      chmodSync(join(binDir, 'paqad-ai'), 0o755);
    } catch {}
  }
  const envFile = env.CLAUDE_ENV_FILE;
  if (typeof envFile === 'string' && envFile.length > 0) {
    try {
      appendFileSync(envFile, `PATH=${binDir}${delimiter}${env.PATH ?? ''}\n`);
    } catch {}
  }
}

const HOME_STAGE_AGENTS = [
  'paqad-planning.md',
  'paqad-specification.md',
  'paqad-development.md',
  'paqad-review.md',
  'paqad-checks.md',
  'paqad-documentation-sync.md',
];

function claudeAgentsDir(env = process.env) {
  return join(claudeDir(env), 'agents');
}

function removeDeadNpmHookLines(settingsPath = claudeSettingsPath()) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return;
  }
  const hooks = settings && typeof settings === 'object' ? settings.hooks : undefined;
  if (!hooks || typeof hooks !== 'object') return;
  let changed = false;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      const kept = entry.hooks.filter((hk) => {
        const script = paqadHookScriptPath(hk && hk.command);
        if (script === null) return true;
        return existsSync(script);
      });
      if (kept.length !== entry.hooks.length) {
        entry.hooks = kept;
        changed = true;
      }
    }
    hooks[event] = entries.filter(
      (entry) => !entry || !Array.isArray(entry.hooks) || entry.hooks.length > 0,
    );
    if (hooks[event].length !== entries.length) changed = true;
  }
  if (changed) {
    try {
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    } catch {}
  }
}

function pluginSeenPath(env = process.env) {
  const data = env.PAQAD_FRAMEWORK_HOME
    ? dirname(env.PAQAD_FRAMEWORK_HOME)
    : join(homedir(), '.paqad-ai');
  return join(data, 'plugin-seen.json');
}
function writePluginSeen(pluginRoot, env = process.env) {
  try {
    const path = pluginSeenPath(env);
    mkdirSync(dirname(path), { recursive: true });
    const payload = {
      version: readPackageVersion(pluginRoot),
      at: new Date().toISOString(),
      root: pluginRoot,
    };
    writeFileSync(path, JSON.stringify(payload));
  } catch {}
}

function removeHomeStageAgents(agentsDir = claudeAgentsDir()) {
  for (const name of HOME_STAGE_AGENTS) {
    try {
      rmSync(join(agentsDir, name), { force: true });
    } catch {}
  }
}

const UPDATE_THROTTLE_MS = 6 * 60 * 60 * 1000;

function frameworkVersionTxtVersion(projectRoot) {
  try {
    const txt = readFileSync(join(projectRoot, '.paqad', 'framework-version.txt'), 'utf8');
    const m = txt.match(/^version=(.*)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function shouldRefreshVersion(pluginVersion, frameworkVersion) {
  if (!pluginVersion) return false;
  if (!frameworkVersion) return true;
  return compareVersions(pluginVersion, frameworkVersion) > 0;
}

/* v8 ignore start -- spawns the real detached `update --silent`; the decision around it is unit
   tested through the injected runUpdate seam and the real run is covered by manual sign-off. */
function spawnSilentUpdate(pluginRoot, projectRoot) {
  const cli = join(pluginRoot, 'dist', 'cli', 'index.js');
  const child = spawn(
    process.execPath,
    [cli, 'update', '--silent', '--project-root', projectRoot],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
}
/* v8 ignore stop */

function maybeRefreshVersion(pluginRoot, projectRoot, deps = {}) {
  const now = deps.now ?? Date.now;
  const runUpdate = deps.runUpdate ?? spawnSilentUpdate;
  const pluginVersion = readPackageVersion(pluginRoot);
  const frameworkVersion = frameworkVersionTxtVersion(projectRoot);
  if (!shouldRefreshVersion(pluginVersion, frameworkVersion)) return 'current';
  const lock = join(projectRoot, '.paqad', 'locks', 'update.lock');
  const existing = lstatSafe(lock);
  if (existing && now() - existing.mtimeMs < UPDATE_THROTTLE_MS) return 'throttled';
  try {
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, String(process.pid));
  } catch {
    return 'throttled';
  }
  runUpdate(pluginRoot, projectRoot);
  return 'started';
}

export function runPluginSessionStart(env = process.env, payload = undefined, deps = {}) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    return;
  }
  const pluginRuntime = join(pluginRoot, 'runtime');
  writePluginSeen(pluginRoot, env);
  (deps.tick ?? maybeSpawnMigrationTick)({
    source: 'plugin',
    sessionId: sessionIdFrom(payload, env),
    cliPath: join(pluginRoot, 'dist', 'cli', 'index.js'),
    env,
  });
  repointFrameworkLink(pluginRuntime, env);

  const projectRoot = resolveProjectRoot(env, payload);
  if (!isProjectOnboarded(projectRoot)) {
    ensureBinOnPath(pluginRuntime, env);
    return;
  }

  if (pluginStandsDownPassive(payload, env)) {
    return;
  }
  writePluginActiveMarker(payload, env);
  if (pluginRootStandsDown(payload, env)) {
    return;
  }
  ensureBinOnPath(pluginRuntime, env);
  removeDeadNpmHookLines(claudeSettingsPath(env));
  removeHomeStageAgents(claudeAgentsDir(env));
  maybeRefreshVersion(pluginRoot, projectRoot);
}

export const __test = {
  compareVersions,
  readPackageVersion,
  repointFrameworkLink,
  ensureStablePluginRuntime,
  stableRuntimeHome,
  isNpmRuntime,
  isPluginCacheRuntime,
  ensureBinOnPath,
  frameworkHome,
  symlinkType,
  hasLiveNpmHookLines,
  projectClaudeSettingsPaths,
  anyLiveNpmHookLines,
  pluginSeenPath,
  writePluginSeen,
  removeDeadNpmHookLines,
  removeHomeStageAgents,
  paqadHookScriptPath,
  claudeDir,
  shouldRefreshVersion,
  frameworkVersionTxtVersion,
  maybeRefreshVersion,
};

if (isDirectEntry(import.meta.url)) {
  try {
    let payload;
    try {
      payload = parseHookPayload(readFileSync(0, 'utf8'));
    } catch {
      payload = undefined;
    }
    runPluginSessionStart(process.env, payload);
  } catch {}
}
