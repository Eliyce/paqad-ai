#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  isPaqadDisabled,
  npmHookStepsAside,
  parseHookPayload,
  readLayeredKey,
  sessionIdFrom,
} from './lib/paqad-disabled.mjs';
import { frameworkPackageRoot, maybeSpawnMigrationTick } from './lib/plugin-migration-tick.mjs';

const DEFAULT_INTERVAL_HOURS = 12;
const STALE_LOCK_MS = 60 * 60 * 1000;
const NPM_TIMEOUT_MS = 5000;

async function main() {
  const projectRoot =
    process.env.CLAUDE_PROJECT_DIR || process.env.PAQAD_PROJECT_ROOT || process.cwd();

  if (isPaqadDisabled(projectRoot)) {
    return;
  }
  if (process.env.CLAUDE_PROJECT_DIR) {
    tickPluginMigration();
  }
  if (npmHookStepsAside(undefined)) {
    return;
  }

  const versionFile = join(projectRoot, '.paqad', 'framework-version.txt');
  const logsDir = join(projectRoot, '.paqad', 'logs');

  if (!existsSync(versionFile)) {
    seedVersionFile(versionFile);
    return;
  }
  const current = readVersionField(versionFile, 'version');
  if (!current) return;

  let policy;
  try {
    const url = new URL('../../dist/update/update-policy.js', import.meta.url);
    const { resolveUpdatePolicy } = await import(url.href);
    policy = resolveUpdatePolicy(projectRoot, process.env, current);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLine(logsDir, `WARN silent-update update setting unreadable, not updating: ${message}`);
    return;
  }
  if (policy.error) {
    logLine(logsDir, `WARN silent-update update setting unreadable, not updating: ${policy.error}`);
    return;
  }
  if (!policy.automatic) return;

  if (policy.pin) {
    if (policy.pin === current) return;
    startUpdate(projectRoot, logsDir, `pinned self-update ${current} -> ${policy.pin}`, policy.pin);
    return;
  }

  const intervalHours = resolveIntervalHours(projectRoot);
  if (withinInterval(readVersionField(versionFile, 'updated_at'), intervalHours)) {
    return;
  }

  const latest = fetchLatestVersion();
  if (!latest) return;

  const nowIso = new Date().toISOString();
  const decision = classify(current, latest);
  if (decision === 'current') {
    touchUpdatedAt(versionFile, current, nowIso);
    return;
  }
  startUpdate(projectRoot, logsDir, `${decision} self-update ${current} -> ${latest}`, 'latest');
}

function logLine(logsDir, text) {
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {}
  appendLine(join(logsDir, 'auto-update.log'), `[${new Date().toISOString()}] ${text}`);
}

function startUpdate(projectRoot, logsDir, what, target) {
  const lockDir = acquireLock(projectRoot);
  if (!lockDir) return;
  try {
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, 'auto-update.log');
    appendLine(
      logPath,
      `[${new Date().toISOString()}] INFO silent-update ${what} (npm install -g paqad-ai@${target})`,
    );
    spawnBackgroundUpdate(logPath, projectRoot, target);
  } finally {
    releaseLock(lockDir);
  }
}

function tickPluginMigration() {
  try {
    const payload = parseHookPayload(readFileSync(0, 'utf8'));
    if (payload?.source === 'compact') return;
    maybeSpawnMigrationTick({
      source: npmHookStepsAside(payload) ? 'plugin' : 'npm',
      sessionId: sessionIdFrom(payload),
    });
  } catch {}
}

function seedVersionFile(versionFile) {
  const pkgRoot = frameworkPackageRoot();
  if (!pkgRoot) return;
  const pkg = readFileSafe(join(pkgRoot, 'package.json'));
  if (!pkg) return;
  let version;
  try {
    version = JSON.parse(pkg).version;
  } catch {
    return;
  }
  if (!version) return;
  try {
    mkdirSync(dirname(versionFile), { recursive: true });
    writeFileSync(versionFile, `version=${version}\nupdated_at=1970-01-01T00:00:00Z\n`);
  } catch {}
}

function readFileSafe(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readVersionField(file, field) {
  const content = readFileSafe(file);
  if (!content) return null;
  const match = content.match(new RegExp(`^${field}=(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

function resolveIntervalHours(projectRoot) {
  const raw = readLayeredKey(
    projectRoot,
    'version_check_interval_hours',
    'PAQAD_VERSION_CHECK_INTERVAL_HOURS',
  );
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_HOURS;
}

function withinInterval(updatedAt, intervalHours) {
  if (!updatedAt) return false;
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return false;
  const elapsedHours = (Date.now() - updatedMs) / 3_600_000;
  return elapsedHours < intervalHours;
}

function fetchLatestVersion() {
  try {
    const out = execFileSync('npm', ['view', 'paqad-ai', 'version'], {
      timeout: NPM_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      shell: true,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function parseVersion(value) {
  const parts = String(value)
    .split('.')
    .map((part) => Number(part) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function classify(current, latest) {
  const [cmaj, cmin, cpatch] = parseVersion(current);
  const [lmaj, lmin, lpatch] = parseVersion(latest);
  const behind =
    cmaj < lmaj ||
    (cmaj === lmaj && cmin < lmin) ||
    (cmaj === lmaj && cmin === lmin && cpatch < lpatch);
  if (!behind) return 'current';
  const inWindow = cmaj === lmaj && cmin >= lmin - 1;
  return inWindow ? 'routine' : 'forced';
}

function touchUpdatedAt(versionFile, current, nowIso) {
  try {
    writeFileSync(versionFile, `version=${current}\nupdated_at=${nowIso}\n`);
  } catch {}
}

function acquireLock(projectRoot) {
  const lockDir = join(projectRoot, '.paqad', 'locks', 'update.lock');
  try {
    mkdirSync(dirname(lockDir), { recursive: true });
  } catch {}
  try {
    mkdirSync(lockDir);
    return lockDir;
  } catch {
    try {
      const ageMs = Date.now() - statSync(lockDir).mtimeMs;
      if (ageMs > STALE_LOCK_MS) {
        rmdirSync(lockDir);
        mkdirSync(lockDir);
        return lockDir;
      }
    } catch {}
    return null;
  }
}

function releaseLock(lockDir) {
  try {
    rmdirSync(lockDir);
  } catch {}
}

function appendLine(logPath, line) {
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {}
}

function spawnBackgroundUpdate(logPath, projectRoot, target) {
  if (!/^(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.test(target)) return;
  try {
    const out = openSync(logPath, 'a');
    const child = spawn(`npm install -g paqad-ai@${target} && paqad-ai update --silent`, {
      shell: true,
      detached: true,
      cwd: projectRoot,
      stdio: ['ignore', out, out],
    });
    child.unref();
  } catch {}
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
