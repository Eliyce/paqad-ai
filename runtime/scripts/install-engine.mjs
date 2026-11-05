#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NPM_FLAGS = ['--no-audit', '--no-fund', '--omit=dev', '--save-exact'];

const PROVIDER_KEYS = new Set([
  'OPENAI_API_KEY',
  'COHERE_API_KEY',
  'CLAUDE_PLUGIN_OPTION_OPENAI_API_KEY',
  'CLAUDE_PLUGIN_OPTION_COHERE_API_KEY',
]);

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
      { cwd: env.PAQAD_ENGINE_REBUILD_ROOT, env, stdio: ['ignore', fd, fd] },
    );
  } catch (error) {
    appendToLog(env, `rag rebuild failed: ${firstLine(error)}`);
  }
}

function installEngines(env) {
  const specs = env.PAQAD_ENGINE_SPECS.split(' ');
  const npmArgs = ['install', ...specs, ...NPM_FLAGS];
  try {
    const fd = openSync(env.PAQAD_ENGINE_LOG, 'a');
    appendFileSync(fd, `npm ${npmArgs.join(' ')}\n`);
    execFileSync('npm', npmArgs, {
      cwd: env.PAQAD_ENGINE_DIR,
      env: withoutProviderKeys(env),
      stdio: ['ignore', fd, fd],
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
