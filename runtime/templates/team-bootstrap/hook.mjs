#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PAQAD_LAUNCHER_VERSION = '__PAQAD_VERSION__';
export const PLUGIN_REPO_URL = 'https://github.com/Eliyce/paqad-claude-plugin.git';
export const PLUGIN_ID = 'paqad@eliyce';
export const SETUP_LINE_LAPTOP = 'Setting up paqad for this repo (one time).';
export const SETUP_LINE_CLOUD = 'Setting up paqad for this cloud session.';
export const FAILED_NOTICE =
  'paqad could not be set up for this repo, so its checks and evidence are off for this session. Tell the user this once, in one sentence, then continue normally.';
export const STILL_SETTING_UP =
  'paqad is still being set up for this repo, so this edit is blocked until it is ready; try it again in a moment.';
export const REFRESH_FLAG = '--paqad-team-refresh';

export const LOCK_STALE_MS = 600 * 1000;
export const LOCK_WAIT_MS = 590 * 1000;
export const LOCK_POLL_MS = 500;
export const CLONE_TIMEOUT_MS = 540 * 1000;
export const EDIT_WAIT_MS = 5 * 1000;
export const REFRESH_AGE_MS = 6 * 60 * 60 * 1000;
export const MIN_NODE_MAJOR = 22;

export const REQUIRED_COPY_SCRIPTS = [
  'plugin-session-start.mjs',
  'agent-entry-session-start.mjs',
  'agent-entry-gate.mjs',
  'decision-pause-gate.mjs',
  'capability-gate.mjs',
];

const ENV_TRUTHY = ['1', 'true', 'yes', 'on'];
const FALSY = ['false', '0', 'no', 'off'];
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const SCRIPT_EVENTS = {
  'agent-entry-gate.mjs': 'PreToolUse',
  'stage-writer.mjs': 'PreToolUse',
  'decision-pause-gate.mjs': 'PreToolUse',
  'agent-entry-prompt-gate.mjs': 'UserPromptSubmit',
  'ticket-intake-prompt.mjs': 'UserPromptSubmit',
  'agent-entry-session-start.mjs': 'SessionStart',
  'silent-update.mjs': 'SessionStart',
  'stage-marker-parse.mjs': 'Stop',
  'verification-completion.mjs': 'Stop',
  'stage-agent-start.mjs': 'SubagentStart',
  'stage-agent-completion.mjs': 'SubagentStop',
  'skill-activation.mjs': 'PostToolUse',
};

function lower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function slash(path) {
  return String(path).split('\\').join('/');
}

export function readKeyFromFile(path, key) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  let value;
  const re = new RegExp('^\\s*(?:export\\s+)?' + key + '\\s*=(.*)$');
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(re);
    if (m) value = m[1];
  }
  if (value === undefined) return undefined;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  } else {
    const hash = v.search(/\s#/);
    if (hash !== -1) v = v.slice(0, hash).trim();
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
  const sorted = names.filter((n) => /^\.config\..+/.test(n) && n !== '.config.example').sort();
  for (let i = 0; i < sorted.length; i += 1) {
    const fromFile = readKeyFromFile(join(dir, sorted[i]), key);
    if (fromFile !== undefined) value = fromFile;
  }
  return value;
}

export function readLayeredKey(projectRoot, key, envName, env) {
  let value = readKeyFromConfigsDir(projectRoot, key);
  const local = readKeyFromFile(join(projectRoot, '.paqad', '.config'), key);
  if (local !== undefined) value = local;
  const fromEnv = env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') value = fromEnv.trim();
  return value;
}

export function keyIsOff(projectRoot, key, envName, env) {
  const raw = readLayeredKey(projectRoot, key, envName, env);
  return raw !== undefined && FALSY.indexOf(lower(raw)) !== -1;
}

export function offSwitch(projectRoot, env) {
  if (ENV_TRUTHY.indexOf(lower(env.PAQAD_DISABLED)) !== -1) return 'PAQAD_DISABLED';
  if (keyIsOff(projectRoot, 'paqad_enable', 'PAQAD_ENABLE', env)) return 'paqad_enable';
  return null;
}

export function canonicalRoot(path) {
  let full;
  try {
    full = realpathSync.native(path);
  } catch {
    full = resolve(path);
  }
  const trimmed = full.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

export function claudeDir(env, home) {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function pluginEntries(parsed) {
  const plugins = parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : parsed;
  const value = plugins[PLUGIN_ID];
  return Array.isArray(value) ? value : [value];
}

export function installedPluginRoots(env, home) {
  const parsed = readJson(join(claudeDir(env, home), 'plugins', 'installed_plugins.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  const roots = pluginEntries(parsed)
    .map((entry) => (entry && typeof entry === 'object' ? entry.installPath : undefined))
    .filter((path) => typeof path === 'string' && path.trim() !== '')
    .map((path) => canonicalRoot(path));
  return roots.length > 0 ? roots : null;
}

function entryLoadsHere(entry, projectRoot) {
  if (!entry || typeof entry !== 'object') return false;
  const path = entry.installPath;
  if (typeof path !== 'string' || path.trim() === '' || !existsSync(path)) return false;
  const scope = typeof entry.scope === 'string' ? entry.scope : 'user';
  if (scope !== 'project' && scope !== 'local') return true;
  return (
    typeof entry.projectPath === 'string' &&
    canonicalRoot(entry.projectPath) === canonicalRoot(projectRoot)
  );
}

export function pluginSettingsLayers(projectRoot, env, home) {
  return [
    join(claudeDir(env, home), 'settings.json'),
    join(projectRoot, '.claude', 'settings.json'),
    join(projectRoot, '.claude', 'settings.local.json'),
  ];
}

export function pluginEnabledInSettings(projectRoot, env, home) {
  let enabled;
  const layers = pluginSettingsLayers(projectRoot, env, home);
  for (let i = 0; i < layers.length; i += 1) {
    const settings = readJson(layers[i]);
    const map = settings && typeof settings === 'object' ? settings.enabledPlugins : undefined;
    if (map && typeof map === 'object' && typeof map[PLUGIN_ID] === 'boolean') {
      enabled = map[PLUGIN_ID];
    }
  }
  return enabled !== false;
}

export function pluginLoadState(projectRoot, env, home) {
  const parsed = readJson(join(claudeDir(env, home), 'plugins', 'installed_plugins.json'));
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 2) return 'unknown';
  if (!parsed.plugins || typeof parsed.plugins !== 'object') return 'unknown';
  const loads = pluginEntries(parsed).some((entry) => entryLoadsHere(entry, projectRoot));
  if (!loads) return 'absent';
  return pluginEnabledInSettings(projectRoot, env, home) ? 'live' : 'absent';
}

export function teamPluginRoot(home) {
  return join(home, '.paqad-ai', 'team-plugin');
}

export function teamPluginData(home) {
  return join(home, '.paqad-ai', 'team-plugin-data');
}

function isUnder(path, root) {
  const p = slash(path);
  const r = slash(root);
  return p === r || p.startsWith(r + '/');
}

function packageNameAt(dir) {
  const parsed = readJson(join(dir, 'package.json'));
  return parsed && typeof parsed.name === 'string' ? parsed.name : null;
}

export function npmRuntimeTarget(env, home) {
  const link = env.PAQAD_FRAMEWORK_HOME || join(home, '.paqad-ai', 'current');
  let target;
  try {
    target = realpathSync.native(link);
  } catch {
    return null;
  }
  const canon = canonicalRoot(target);
  if (isUnder(canon, canonicalRoot(teamPluginRoot(home)))) return null;
  if (isUnder(canon, canonicalRoot(teamPluginData(home)))) return null;
  if (slash(canon).indexOf('/plugins/') !== -1) return null;
  const underNodeModules = slash(canon).indexOf('/node_modules/') !== -1;
  if (!underNodeModules && packageNameAt(dirname(target)) !== 'paqad-ai') return null;
  return existsSync(join(target, 'hooks')) ? target : null;
}

export function inferEvent(payload, script, args) {
  if (payload && typeof payload.hook_event_name === 'string' && payload.hook_event_name !== '') {
    return payload.hook_event_name;
  }
  if (script === 'capability-gate.mjs') {
    return args[0] === 'completion' ? 'Stop' : 'PreToolUse';
  }
  return SCRIPT_EVENTS[script] || '';
}

function parsePayload(stdin) {
  try {
    const parsed = JSON.parse(stdin.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function safeSessionId(payload) {
  const raw = payload && typeof payload.session_id === 'string' ? payload.session_id.trim() : '';
  return SESSION_ID.test(raw) ? raw : null;
}

function sessionDir(projectRoot, name) {
  return join(projectRoot, '.paqad', 'session', name);
}

export function routeRecordPath(projectRoot, sid) {
  return join(sessionDir(projectRoot, 'team-route.d'), sid);
}

export function noticePath(projectRoot, sid) {
  return join(sessionDir(projectRoot, 'team-bootstrap-notice.d'), sid);
}

function readRoute(projectRoot, sid) {
  if (!sid) return null;
  const parsed = readJson(routeRecordPath(projectRoot, sid));
  return parsed && typeof parsed.route === 'string' ? parsed : null;
}

function writeRoute(projectRoot, sid, record, ctx) {
  if (!sid) return;
  try {
    mkdirSync(sessionDir(projectRoot, 'team-route.d'), { recursive: true });
    writeFileSync(routeRecordPath(projectRoot, sid), JSON.stringify(record));
  } catch (error) {
    logLine(projectRoot, 'route record not written: ' + errorCode(error), ctx);
  }
}

function errorCode(error) {
  return error && typeof error === 'object' && error.code ? String(error.code) : 'error';
}

export function logLine(projectRoot, line, ctx) {
  try {
    const dir = join(projectRoot, '.paqad', 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, 'hooks.log'),
      new Date(ctx.deps.now()).toISOString() + ' team-launcher: ' + line + '\n',
    );
  } catch {
    return;
  }
}

function claimNotice(projectRoot, sid) {
  if (!sid) return true;
  try {
    mkdirSync(sessionDir(projectRoot, 'team-bootstrap-notice.d'), { recursive: true });
    writeFileSync(noticePath(projectRoot, sid), '', { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function lockDir(home) {
  return join(home, '.paqad-ai', 'locks', 'team-plugin.lock');
}

function defaultPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

export function lockIsStale(home, deps) {
  const dir = lockDir(home);
  const owner = readJson(join(dir, 'owner.json'));
  let started;
  if (owner && typeof owner.started_at === 'number') {
    started = owner.started_at;
  } else {
    try {
      started = statSync(dir).mtimeMs;
    } catch {
      return false;
    }
  }
  if (deps.now() - started > LOCK_STALE_MS) return true;
  return Boolean(owner && typeof owner.pid === 'number' && !deps.pidAlive(owner.pid));
}

function lockHeld(home) {
  return existsSync(lockDir(home));
}

function mkdirLock(home, deps) {
  const dir = lockDir(home);
  try {
    mkdirSync(dir);
  } catch {
    return false;
  }
  try {
    writeFileSync(
      join(dir, 'owner.json'),
      JSON.stringify({ pid: deps.pid, started_at: deps.now() }),
    );
  } catch {
    return true;
  }
  return true;
}

export function acquireLock(home, deps) {
  try {
    mkdirSync(dirname(lockDir(home)), { recursive: true });
  } catch {
    return false;
  }
  if (mkdirLock(home, deps)) return true;
  if (!lockIsStale(home, deps)) return false;
  rmSync(lockDir(home), { recursive: true, force: true });
  return mkdirLock(home, deps);
}

export function releaseLock(home) {
  rmSync(lockDir(home), { recursive: true, force: true });
}

function copyIsPresent(home) {
  return existsSync(join(teamPluginRoot(home), 'runtime', 'hooks'));
}

export function waitForCopy(home, deps, limitMs) {
  const deadline = deps.now() + limitMs;
  for (;;) {
    if (copyIsPresent(home)) return true;
    if (!lockHeld(home) || lockIsStale(home, deps)) return false;
    if (deps.now() >= deadline) return false;
    deps.sleep(LOCK_POLL_MS);
  }
}

function tempPrefix() {
  return 'team-plugin.tmp-';
}

export function sweepTemps(home, deps) {
  const base = join(home, '.paqad-ai');
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return;
  }
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (!name.startsWith(tempPrefix()) && !name.startsWith('team-plugin.old-')) continue;
    const pid = Number(name.slice(name.lastIndexOf('-') + 1));
    if (pid === deps.pid || (Number.isInteger(pid) && pid > 0 && deps.pidAlive(pid))) continue;
    rmSync(join(base, name), { recursive: true, force: true });
  }
}

function copyIsComplete(dir) {
  const hooks = join(dir, 'runtime', 'hooks');
  return REQUIRED_COPY_SCRIPTS.every((name) => existsSync(join(hooks, name)));
}

export function cloneInto(home, deps, ctx) {
  const tmp = join(home, '.paqad-ai', tempPrefix() + deps.pid);
  rmSync(tmp, { recursive: true, force: true });
  const result = deps.runGit(['clone', '--depth', '1', '--quiet', PLUGIN_REPO_URL, tmp], {
    timeout: CLONE_TIMEOUT_MS,
  });
  if (!result || result.status !== 0 || result.error || !copyIsComplete(tmp)) {
    rmSync(tmp, { recursive: true, force: true });
    const why = result && result.error ? errorCode(result.error) : 'exit ' + (result && result.status);
    logLine(ctx.projectRoot, 'clone failed (' + why + ')', ctx);
    return null;
  }
  return tmp;
}

function installCopy(home, deps, ctx) {
  const tmp = cloneInto(home, deps, ctx);
  if (!tmp) return false;
  try {
    renameSync(tmp, teamPluginRoot(home));
    return true;
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    logLine(ctx.projectRoot, 'install rename failed (' + errorCode(error) + ')', ctx);
    return false;
  }
}

export function swapCopy(home, tmp, deps) {
  const live = teamPluginRoot(home);
  const old = join(home, '.paqad-ai', 'team-plugin.old-' + deps.pid);
  rmSync(old, { recursive: true, force: true });
  renameSync(live, old);
  try {
    renameSync(tmp, live);
  } catch (error) {
    renameSync(old, live);
    throw error;
  }
  rmSync(old, { recursive: true, force: true });
}

export function runRefresh(home, deps, ctx) {
  if (!acquireLock(home, deps)) return 'busy';
  try {
    sweepTemps(home, deps);
    const tmp = cloneInto(home, deps, ctx);
    if (!tmp) {
      logLine(ctx.projectRoot, 'refresh failed; the current copy keeps working', ctx);
      return 'failed';
    }
    try {
      swapCopy(home, tmp, deps);
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true });
      logLine(ctx.projectRoot, 'refresh swap failed (' + errorCode(error) + ')', ctx);
      return 'failed';
    }
    return 'refreshed';
  } finally {
    releaseLock(home);
  }
}

export function copyAgeMs(home, deps) {
  const root = teamPluginRoot(home);
  let stamp;
  try {
    stamp = statSync(join(root, '.git', 'FETCH_HEAD')).mtimeMs;
  } catch {
    try {
      stamp = statSync(root).mtimeMs;
    } catch {
      return 0;
    }
  }
  return deps.now() - stamp;
}

function maybeStartRefresh(home, deps, ctx) {
  if (copyAgeMs(home, deps) <= REFRESH_AGE_MS) return false;
  try {
    deps.spawnDetached(process.execPath, [deps.launcherPath, REFRESH_FLAG, ctx.projectRoot], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: ctx.env,
    });
    return true;
  } catch (error) {
    logLine(ctx.projectRoot, 'refresh not started (' + errorCode(error) + ')', ctx);
    return false;
  }
}

function appendEnvFileLine(env, line) {
  const file = env.CLAUDE_ENV_FILE;
  if (typeof file !== 'string' || file === '') return;
  let existing;
  try {
    existing = readFileSync(file, 'utf8');
  } catch {
    existing = '';
  }
  if (existing.split(/\r?\n/).indexOf(line) !== -1) return;
  const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(file, lead + line + '\n');
}

function isRemote(env) {
  return lower(env.CLAUDE_CODE_REMOTE) === 'true';
}

function copyEnv(env, home) {
  const out = Object.assign({}, env, {
    CLAUDE_PLUGIN_ROOT: teamPluginRoot(home),
    CLAUDE_PLUGIN_DATA: teamPluginData(home),
  });
  if (isRemote(env)) out.PAQAD_RAG_ENABLED = 'false';
  return out;
}

function runChild(hookPath, args, ctx, env) {
  if (!existsSync(hookPath)) return { started: false };
  const result = ctx.deps.spawnSync(process.execPath, [hookPath].concat(args), {
    input: ctx.stdin,
    stdio: ['pipe', 'inherit', 'inherit'],
    env,
    windowsHide: true,
  });
  if (!result || result.error || typeof result.status !== 'number') return { started: false };
  return { started: true, status: result.status };
}

function exitFor(child, ctx) {
  const blocking = ctx.event === 'PreToolUse';
  if (!child.started) return blocking ? 2 : 0;
  if (child.status === 0 || child.status === 2) return child.status;
  return blocking ? 2 : child.status;
}

function missingScript(ctx, route) {
  if (ctx.event !== 'PreToolUse') return 0;
  const reason =
    route === 'npm'
      ? ' because your paqad-ai install does not have it, so update your own paqad-ai (for example `npm install -g paqad-ai@latest`) and try again.\n'
      : ' because the paqad setup committed in this repo is out of date, so the lead must run `paqad-ai update` and commit the result.\n';
  ctx.deps.stderr('paqad cannot run ' + ctx.script + reason);
  return 2;
}

function runNpm(target, ctx) {
  const hookPath = join(target, 'hooks', ctx.script);
  if (!ctx.validScript || !existsSync(hookPath)) return missingScript(ctx, 'npm');
  return exitFor(runChild(hookPath, ctx.args, ctx, ctx.env), ctx);
}

function runCopy(ctx) {
  const home = ctx.home;
  if (ctx.script === 'silent-update.mjs') return 0;
  const hooks = join(teamPluginRoot(home), 'runtime', 'hooks');
  const hookPath = join(hooks, ctx.script);
  if (!ctx.validScript || !existsSync(hookPath)) return missingScript(ctx, 'copy');
  const env = copyEnv(ctx.env, home);
  if (ctx.event === 'SessionStart' && isRemote(ctx.env)) {
    try {
      appendEnvFileLine(ctx.env, 'PAQAD_RAG_ENABLED=false');
    } catch (error) {
      logLine(ctx.projectRoot, 'env file not updated (' + errorCode(error) + ')', ctx);
    }
  }
  if (ctx.script === 'agent-entry-session-start.mjs') {
    runChild(join(hooks, 'plugin-session-start.mjs'), [], ctx, env);
  }
  return exitFor(runChild(hookPath, ctx.args, ctx, env), ctx);
}

function printNotice(ctx) {
  if (ctx.event !== 'SessionStart' && ctx.event !== 'UserPromptSubmit') return;
  if (!claimNotice(ctx.projectRoot, ctx.sid)) return;
  ctx.deps.stdout(FAILED_NOTICE + '\n');
}

export function setupMessage(env) {
  const line = isRemote(env) ? SETUP_LINE_CLOUD : SETUP_LINE_LAPTOP;
  return '{"systemMessage": "' + line + '"}\n';
}

function nodeTooOld(deps) {
  return deps.nodeMajor < MIN_NODE_MAJOR;
}

function installAtSessionStart(ctx) {
  const home = ctx.home;
  const deps = ctx.deps;
  if (nodeTooOld(deps)) return { route: 'none', reason: 'node-too-old' };
  if (acquireLock(home, deps)) {
    let installed;
    try {
      if (copyIsPresent(home)) return { route: 'copy', reason: 'installed-by-peer' };
      sweepTemps(home, deps);
      installed = installCopy(home, deps, ctx);
    } finally {
      releaseLock(home);
    }
    if (!installed) return { route: 'none', reason: 'install-failed' };
    deps.stdout(setupMessage(ctx.env));
    return { route: 'copy', reason: 'installed' };
  }
  if (waitForCopy(home, deps, LOCK_WAIT_MS)) return { route: 'copy', reason: 'installed-by-peer' };
  return { route: 'none', reason: 'install-wait-ended' };
}

export function decideRoute(ctx) {
  const off = offSwitch(ctx.projectRoot, ctx.env);
  if (off) return { route: 'off', reason: off };
  if (pluginLoadState(ctx.projectRoot, ctx.env, ctx.home) === 'live') {
    return { route: 'plugin', reason: 'plugin-installed' };
  }
  const target = npmRuntimeTarget(ctx.env, ctx.home);
  if (target) return { route: 'npm', reason: 'npm-installed', target };
  if (keyIsOff(ctx.projectRoot, 'team_bootstrap_enabled', 'PAQAD_TEAM_BOOTSTRAP_ENABLED', ctx.env)) {
    return { route: 'none', reason: 'team-bootstrap-disabled' };
  }
  if (copyIsPresent(ctx.home)) {
    if (nodeTooOld(ctx.deps)) return { route: 'none', reason: 'node-too-old' };
    return { route: 'copy', reason: 'copy-present' };
  }
  return { route: 'none', reason: 'no-copy' };
}

function sessionStart(ctx) {
  let decided = decideRoute(ctx);
  if (decided.route === 'copy') {
    sweepTemps(ctx.home, ctx.deps);
    maybeStartRefresh(ctx.home, ctx.deps, ctx);
  } else if (decided.route === 'none' && decided.reason === 'no-copy') {
    decided = installAtSessionStart(ctx);
  }
  writeRoute(ctx.projectRoot, ctx.sid, decided, ctx);
  if (ctx.script === 'agent-entry-session-start.mjs' || !ctx.sid) {
    logLine(
      ctx.projectRoot,
      'v' + PAQAD_LAUNCHER_VERSION + ' route=' + decided.route + ' reason=' + decided.reason,
      ctx,
    );
  }
  return follow(decided, ctx);
}

function laterEvent(ctx) {
  const recorded = readRoute(ctx.projectRoot, ctx.sid);
  if (recorded) {
    if (ENV_TRUTHY.indexOf(lower(ctx.env.PAQAD_DISABLED)) !== -1) return 0;
    return follow(recorded, ctx);
  }
  const decided = decideRoute(ctx);
  if (decided.route === 'none' && decided.reason === 'no-copy' && lockHeld(ctx.home)) {
    if (lockIsStale(ctx.home, ctx.deps)) return follow(decided, ctx);
    if (ctx.event !== 'PreToolUse') return 0;
    if (waitForCopy(ctx.home, ctx.deps, EDIT_WAIT_MS)) {
      return follow({ route: 'copy', reason: 'installed-while-waiting' }, ctx);
    }
    ctx.deps.stderr(STILL_SETTING_UP + '\n');
    return 2;
  }
  return follow(decided, ctx);
}

function follow(decided, ctx) {
  if (decided.route === 'npm' && typeof decided.target === 'string') {
    return runNpm(decided.target, ctx);
  }
  if (decided.route === 'copy') return runCopy(ctx);
  if (decided.route === 'none' && decided.reason !== 'team-bootstrap-disabled') printNotice(ctx);
  return 0;
}

function defaultDeps() {
  return {
    home: homedir,
    now: Date.now,
    pid: process.pid,
    nodeMajor: Number(String(process.versions.node).split('.')[0]),
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    pidAlive: defaultPidAlive,
    spawnSync,
    spawnDetached: (cmd, args, opts) => spawn(cmd, args, opts).unref(),
    runGit: (args, opts) =>
      spawnSync('git', args, {
        stdio: 'ignore',
        timeout: opts.timeout,
        windowsHide: true,
        env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }),
      }),
    readStdin: () => {
      try {
        return readFileSync(0);
      } catch {
        return Buffer.alloc(0);
      }
    },
    stdout: (text) => writeSync(1, text),
    stderr: (text) => writeSync(2, text),
    launcherPath: fileURLToPath(import.meta.url),
  };
}

function projectRootFrom(env, deps) {
  if (deps.projectRoot) return deps.projectRoot;
  if (typeof env.CLAUDE_PROJECT_DIR === 'string' && env.CLAUDE_PROJECT_DIR !== '') {
    return env.CLAUDE_PROJECT_DIR;
  }
  return dirname(dirname(deps.launcherPath));
}

export function runLauncher(argv, env, overrides) {
  const deps = Object.assign(defaultDeps(), overrides || {});
  const home = deps.home();
  if (argv[0] === REFRESH_FLAG) {
    const projectRoot = argv[1] || projectRootFrom(env, deps);
    runRefresh(home, deps, { projectRoot, env, deps });
    return 0;
  }
  const script = typeof argv[0] === 'string' ? argv[0] : '';
  const args = argv.slice(1);
  const stdin = deps.readStdin();
  const payload = parsePayload(stdin);
  const ctx = {
    deps,
    env,
    home,
    stdin,
    script,
    args,
    validScript: SCRIPT_NAME.test(script),
    event: inferEvent(payload, script, args),
    sid: safeSessionId(payload),
    projectRoot: projectRootFrom(env, deps),
  };
  if (ENV_TRUTHY.indexOf(lower(env.PAQAD_DISABLED)) !== -1) return 0;
  try {
    return ctx.event === 'SessionStart' ? sessionStart(ctx) : laterEvent(ctx);
  } catch (error) {
    logLine(ctx.projectRoot, 'launcher error (' + errorCode(error) + ')', ctx);
    return ctx.event === 'PreToolUse' ? 2 : 0;
  }
}

function isDirectEntry(url, argv1) {
  if (!argv1) return false;
  try {
    return url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  process.exitCode = runLauncher(process.argv.slice(2), process.env);
}
