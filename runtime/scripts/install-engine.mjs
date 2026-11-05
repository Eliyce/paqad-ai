#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const NPM_FLAGS = ['--no-audit', '--no-fund', '--omit=dev', '--save-exact'];

const PROVIDER_KEYS = new Set([
  'OPENAI_API_KEY',
  'COHERE_API_KEY',
  'CLAUDE_PLUGIN_OPTION_OPENAI_API_KEY',
  'CLAUDE_PLUGIN_OPTION_COHERE_API_KEY',
]);

const NPM_CLI = 'npm-cli.js';

const NPM_NOT_FOUND = 'npm was not found: no npm-cli.js beside node or on PATH.';

function envValue(env, wanted) {
  const name = Object.keys(env).find((key) => key.toUpperCase() === wanted);
  return name === undefined ? undefined : env[name];
}

export function npmInvocation({ platform, execPath, env, exists }) {
  if (platform !== 'win32') return { command: 'npm', args: [] };
  const throughNode = (cli) => ({ command: execPath, args: [cli] });
  const declared = envValue(env, 'NPM_EXECPATH');
  if (
    declared &&
    win32.isAbsolute(declared) &&
    win32.basename(declared).toLowerCase() === NPM_CLI &&
    exists(declared)
  ) {
    return throughNode(declared);
  }
  const cliBeside = (dir) => win32.join(dir, 'node_modules', 'npm', 'bin', NPM_CLI);
  const besideNode = cliBeside(win32.dirname(execPath));
  if (exists(besideNode)) return throughNode(besideNode);
  const holder = (envValue(env, 'PATH') ?? '')
    .split(';')
    .find((entry) => win32.isAbsolute(entry) && exists(win32.join(entry, 'npm.cmd')));
  if (holder === undefined || !exists(cliBeside(holder))) return null;
  return throughNode(cliBeside(holder));
}

function withoutProviderKeys(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !PROVIDER_KEYS.has(name.toUpperCase())),
  );
}

function firstLine(error) {
  return String(error instanceof Error ? error.message : error).split('\n')[0];
}

function appendToLog(env, line) {
  try {
    appendFileSync(env.PAQAD_ENGINE_LOG, `${line}\n`);
  } catch (error) {
    console.error(`paqad could not write the engine install log: ${firstLine(error)}`);
  }
}

function writeMarker(env, fields) {
  writeFileSync(
    env.PAQAD_ENGINE_MARKER,
    JSON.stringify({ attempted_at: new Date().toISOString(), ...fields }),
  );
}

function rebuildIndex(env, fd) {
  if (!env.PAQAD_ENGINE_REBUILD_ROOT || !env.PAQAD_ENGINE_CLI) return;
  try {
    execFileSync(
      process.execPath,
      [env.PAQAD_ENGINE_CLI, 'rag', 'rebuild', '--project-root', env.PAQAD_ENGINE_REBUILD_ROOT],
      { cwd: env.PAQAD_ENGINE_REBUILD_ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true },
    );
  } catch (error) {
    appendToLog(env, `rag rebuild failed: ${firstLine(error)}`);
  }
}

function installEngines(env) {
  const specs = env.PAQAD_ENGINE_SPECS.split(' ');
  const npmArgs = ['install', ...specs, ...NPM_FLAGS];
  try {
    const npm = npmInvocation({
      platform: process.platform,
      execPath: process.execPath,
      env,
      exists: existsSync,
    });
    if (npm === null) throw new Error(NPM_NOT_FOUND);
    const fd = openSync(env.PAQAD_ENGINE_LOG, 'a');
    appendFileSync(fd, `npm ${npmArgs.join(' ')}\n`);
    execFileSync(npm.command, [...npm.args, ...npmArgs], {
      cwd: env.PAQAD_ENGINE_DIR,
      env: withoutProviderKeys(env),
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
    writeMarker(env, { status: 'ready', specs });
    rebuildIndex(env, fd);
  } catch (error) {
    const message = firstLine(error);
    appendToLog(env, message);
    writeMarker(env, { status: 'failed', error: message });
  } finally {
    rmSync(env.PAQAD_ENGINE_LOCK, { force: true });
  }
}

function isDirectRun() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) installEngines(process.env);
