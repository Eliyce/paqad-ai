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

function main() {
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

  if (!autoUpdateEnabled(projectRoot)) {
    noteUnmetFloorWhileDisabled(projectRoot, current, logsDir);
    return;
  }

  const minVersion = resolveMinimumVersion(projectRoot);
  const floorUnmet = isPinned(minVersion) && isBehindVersion(current, minVersion);

  const intervalHours = resolveIntervalHours(projectRoot);
  if (!floorUnmet && withinInterval(readVersionField(versionFile, 'updated_at'), intervalHours)) {
    return;
  }

  const latest = fetchLatestVersion();
  if (!latest) return;

  const nowIso = new Date().toISOString();
  const baseDecision = classify(current, latest);
  if (baseDecision === 'current' && !floorUnmet) {
    touchUpdatedAt(versionFile, current, nowIso);
    return;
  }
  if (floorUnmet && isBehindVersion(latest, minVersion)) {
    mkdirSync(logsDir, { recursive: true });
    appendLine(
      join(logsDir, 'auto-update.log'),
      `[${nowIso}] WARN silent-update minimum_version ${minVersion} exceeds latest published ${latest}; cannot satisfy floor`,
    );
    touchUpdatedAt(versionFile, current, nowIso);
    return;
  }
  const decision = floorUnmet ? 'forced-minimum' : baseDecision;

  const lockDir = acquireLock(projectRoot);
  if (!lockDir) return;

  try {
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, 'auto-update.log');
    appendLine(
      logPath,
      `[${nowIso}] INFO silent-update ${decision} self-update ${current} -> ${latest} (npm install -g paqad-ai@latest)`,
    );
    spawnBackgroundUpdate(logPath);
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

const CONFIG_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const CONFIG_FALSY = new Set(['0', 'false', 'no', 'off']);

function autoUpdateEnabled(projectRoot) {
  const auto = readLayeredKey(projectRoot, 'auto_update', 'PAQAD_AUTO_UPDATE');
  if (auto !== undefined && CONFIG_FALSY.has(auto.toLowerCase())) return false;
  const skip = readLayeredKey(projectRoot, 'skip_version_check', 'PAQAD_SKIP_VERSION_CHECK');
  if (skip !== undefined && CONFIG_TRUTHY.has(skip.toLowerCase())) return false;
  return true;
}

function resolveMinimumVersion(projectRoot) {
  return readLayeredKey(projectRoot, 'minimum_version', 'PAQAD_MINIMUM_VERSION') || 'latest';
}

function isPinned(value) {
  return (
    typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'latest'
  );
}

function isBehindVersion(a, b) {
  const [amaj, amin, apat] = parseVersion(a);
  const [bmaj, bmin, bpat] = parseVersion(b);
  return (
    amaj < bmaj || (amaj === bmaj && amin < bmin) || (amaj === bmaj && amin === bmin && apat < bpat)
  );
}

function noteUnmetFloorWhileDisabled(projectRoot, current, logsDir) {
  const minVersion = resolveMinimumVersion(projectRoot);
  if (!isPinned(minVersion) || !isBehindVersion(current, minVersion)) return;
  try {
    mkdirSync(logsDir, { recursive: true });
    appendLine(
      join(logsDir, 'auto-update.log'),
      `[${new Date().toISOString()}] WARN silent-update installed ${current} is below minimum_version ${minVersion}, but auto_update is off — not updating`,
    );
  } catch {}
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

function spawnBackgroundUpdate(logPath) {
  try {
    const out = openSync(logPath, 'a');
    const child = spawn('npm install -g paqad-ai@latest && paqad-ai update --silent', {
      shell: true,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
  } catch {}
}

try {
  main();
} catch {}
process.exit(0);
