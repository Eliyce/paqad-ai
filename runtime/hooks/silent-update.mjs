#!/usr/bin/env node
// silent-update.mjs — SessionStart version-check + forced background self-update.
//
// Cross-platform Node port of the former silent-update.sh. It keeps the globally
// installed paqad-ai CLI current by running `npm install -g paqad-ai@latest` in
// the background whenever a newer version exists. It never blocks, never prompts,
// never produces visible output, and always exits 0.
//
// Why Node instead of bash: the shell version depended on bash + python3 +
// GNU coreutils (`timeout`/`flock`) — none guaranteed on minimal Linux/macOS
// images and absent on Windows. Node is always present (paqad-ai is a Node CLI),
// so a single .mjs is portable across every environment the framework runs in.
//
// Update policy (resolved decision D-2):
//   - The "allowed" window is the latest minor and the one before it, within the
//     SAME major (e.g. latest 1.15.x => 1.15.x and 1.14.x are allowed).
//   - ANY newer version triggers a background `npm install -g paqad-ai@latest`
//     followed by `paqad-ai update --silent` to resync project artifacts.
//   - Being out-of-window (a minor older than the 2-minor band, or any older
//     major) is recorded as a FORCED update so the gap is visible. The action is
//     identical (always background, never blocking) but classified.
//
// Config (read from `.paqad/.config`, the Laravel-style framework config):
//   - AUTO_UPDATE (default on; `SKIP_VERSION_CHECK` is a tolerated deprecated
//     alias). When off, no background install ever runs.
//   - MINIMUM_VERSION (default `latest`). `latest` = track newest (the routine
//     policy above). A pinned `x.y.z` is a hard floor: when the installed
//     version is below it, the update is forced immediately, bypassing the
//     interval throttle, so the floor is reached as fast as possible. This hook
//     never blocks, so an unsatisfiable floor is logged, not enforced.
//   - VERSION_CHECK_INTERVAL_HOURS (default 12).
//
// Project root is resolved from the host-provided env vars (CLAUDE_PROJECT_DIR /
// PAQAD_PROJECT_ROOT), falling back to the current working directory, so the
// single global copy under ~/.paqad-ai/current/hooks/ operates on whichever
// project the session is in — it does NOT derive the root from its own location.

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
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { isPaqadDisabled } from './lib/paqad-disabled.mjs';

const DEFAULT_INTERVAL_HOURS = 12;
const STALE_LOCK_MS = 60 * 60 * 1000; // reap a lock left by a killed run after 60 min
const NPM_TIMEOUT_MS = 5000;

function main() {
  const projectRoot =
    process.env.CLAUDE_PROJECT_DIR || process.env.PAQAD_PROJECT_ROOT || process.cwd();

  // Issue #220 — when paqad is disabled (or env-overridden off), do nothing: no
  // version seed, no version check, and above all no background
  // `npm install -g paqad-ai@latest`. A disabled install stays exactly as the
  // user left it.
  if (isPaqadDisabled(projectRoot)) {
    return;
  }

  const versionFile = join(projectRoot, '.paqad', 'framework-version.txt');
  const logsDir = join(projectRoot, '.paqad', 'logs');

  // ── Step 1: read local version (self-heal when missing) ────────────────────
  // framework-version.txt is per-machine, git-ignored, local-only state. A
  // teammate who clones an already-onboarded repo without re-running onboarding
  // has no copy, so auto-update would silently never run for them. When missing,
  // recreate it from the installed package version (seeded at the epoch so the
  // NEXT session's interval check fires immediately) and exit — we never seed
  // and run a version check in the same session.
  if (!existsSync(versionFile)) {
    seedVersionFile(versionFile);
    return;
  }
  const current = readVersionField(versionFile, 'version');
  if (!current) return;

  // ── Step 2: resolve update policy from `.paqad/.config` ─────────────────────
  // AUTO_UPDATE is the canonical switch (default on); `SKIP_VERSION_CHECK` is a
  // tolerated deprecated alias. When off, do nothing — but still record an unmet
  // hard MINIMUM_VERSION floor so the gap stays visible in the audit log.
  if (!autoUpdateEnabled(projectRoot)) {
    noteUnmetFloorWhileDisabled(projectRoot, current, logsDir);
    return;
  }

  // A pinned MINIMUM_VERSION the install doesn't meet forces an immediate check,
  // bypassing the interval throttle so the floor is reached as fast as possible.
  const minVersion = resolveMinimumVersion(projectRoot);
  const floorUnmet = isPinned(minVersion) && isBehindVersion(current, minVersion);

  const intervalHours = resolveIntervalHours(projectRoot); // interval window
  if (!floorUnmet && withinInterval(readVersionField(versionFile, 'updated_at'), intervalHours)) {
    return;
  }

  // ── Step 3: fetch latest version from npm (5s timeout) ──────────────────────
  const latest = fetchLatestVersion();
  if (!latest) return;

  // ── Step 4: classify (or force, when a pinned floor is unmet) ───────────────
  const nowIso = new Date().toISOString();
  const baseDecision = classify(current, latest);
  if (baseDecision === 'current' && !floorUnmet) {
    // Already up to date — reset the interval window.
    touchUpdatedAt(versionFile, current, nowIso);
    return;
  }
  if (floorUnmet && isBehindVersion(latest, minVersion)) {
    // Even the newest published version is below the floor — unsatisfiable.
    mkdirSync(logsDir, { recursive: true });
    appendLine(
      join(logsDir, 'auto-update.log'),
      `[${nowIso}] WARN silent-update MINIMUM_VERSION ${minVersion} exceeds latest published ${latest}; cannot satisfy floor`,
    );
    touchUpdatedAt(versionFile, current, nowIso);
    return;
  }
  const decision = floorUnmet ? 'forced-minimum' : baseDecision;

  // ── Step 5: acquire lock and spawn background global self-update ─────────────
  const lockDir = acquireLock(projectRoot);
  if (!lockDir) return; // another update is already running

  try {
    mkdirSync(logsDir, { recursive: true });
    const logPath = join(logsDir, 'auto-update.log');
    // Record intent synchronously (before detaching) so the audit log captures
    // the classification even if the background install is slow or fails.
    appendLine(
      logPath,
      `[${nowIso}] INFO silent-update ${decision} self-update ${current} -> ${latest} (npm install -g paqad-ai@latest)`,
    );
    spawnBackgroundUpdate(logPath);
  } finally {
    releaseLock(lockDir);
  }
}

function seedVersionFile(versionFile) {
  const frameworkHome = process.env.PAQAD_FRAMEWORK_HOME || join(homedir(), '.paqad-ai', 'current');
  const pkg = readFileSafe(join(frameworkHome, 'package.json'));
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
  } catch {
    // git-ignored, best-effort; never dirty the tree or fail the session.
  }
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

// ── `.paqad/.config` policy reads (raw, dist-less; mirrors framework-config.ts) ──

const CONFIG_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const CONFIG_FALSY = new Set(['0', 'false', 'no', 'off']);

/** Read the last uncommented `KEY=` value from `.paqad/.config`, or null. */
function readDotConfigValue(projectRoot, key) {
  const content = readFileSafe(join(projectRoot, '.paqad', '.config'));
  if (!content) return null;
  let value;
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`));
    if (m) value = m[1];
  }
  if (value === undefined) return null;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  } else {
    const hash = v.search(/\s#/);
    if (hash !== -1) v = v.slice(0, hash).trim();
  }
  return v.trim();
}

/** AUTO_UPDATE (default on); `SKIP_VERSION_CHECK` truthy is a deprecated off-alias. */
function autoUpdateEnabled(projectRoot) {
  const auto = readDotConfigValue(projectRoot, 'AUTO_UPDATE');
  if (auto !== null && CONFIG_FALSY.has(auto.toLowerCase())) return false;
  const skip = readDotConfigValue(projectRoot, 'SKIP_VERSION_CHECK');
  if (skip !== null && CONFIG_TRUTHY.has(skip.toLowerCase())) return false;
  return true;
}

/** MINIMUM_VERSION (default `latest`). */
function resolveMinimumVersion(projectRoot) {
  return readDotConfigValue(projectRoot, 'MINIMUM_VERSION') || 'latest';
}

/** A pinned floor is any non-empty value other than the `latest` sentinel. */
function isPinned(value) {
  return (
    typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'latest'
  );
}

/** True when version `a` is strictly older than version `b` (major.minor.patch). */
function isBehindVersion(a, b) {
  const [amaj, amin, apat] = parseVersion(a);
  const [bmaj, bmin, bpat] = parseVersion(b);
  return (
    amaj < bmaj || (amaj === bmaj && amin < bmin) || (amaj === bmaj && amin === bmin && apat < bpat)
  );
}

/** When AUTO_UPDATE is off but a pinned floor is unmet, leave an audit breadcrumb. */
function noteUnmetFloorWhileDisabled(projectRoot, current, logsDir) {
  const minVersion = resolveMinimumVersion(projectRoot);
  if (!isPinned(minVersion) || !isBehindVersion(current, minVersion)) return;
  try {
    mkdirSync(logsDir, { recursive: true });
    appendLine(
      join(logsDir, 'auto-update.log'),
      `[${new Date().toISOString()}] WARN silent-update installed ${current} is below MINIMUM_VERSION ${minVersion}, but AUTO_UPDATE is off — not updating`,
    );
  } catch {
    // best-effort
  }
}

function resolveIntervalHours(projectRoot) {
  const raw = readDotConfigValue(projectRoot, 'VERSION_CHECK_INTERVAL_HOURS');
  const n = raw === null ? Number.NaN : Number(raw);
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
    // shell:true so `npm` resolves to `npm.cmd` on Windows; static args, no input.
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

// Prints one of: "current" | "routine" | "forced".
function classify(current, latest) {
  const [cmaj, cmin, cpatch] = parseVersion(current);
  const [lmaj, lmin, lpatch] = parseVersion(latest);
  const behind =
    cmaj < lmaj ||
    (cmaj === lmaj && cmin < lmin) ||
    (cmaj === lmaj && cmin === lmin && cpatch < lpatch);
  if (!behind) return 'current';
  // Allowed window: same major AND within the last two minors (>= latest minor - 1).
  const inWindow = cmaj === lmaj && cmin >= lmin - 1;
  return inWindow ? 'routine' : 'forced';
}

function touchUpdatedAt(versionFile, current, nowIso) {
  try {
    writeFileSync(versionFile, `version=${current}\nupdated_at=${nowIso}\n`);
  } catch {
    // best-effort
  }
}

// Single-flight lock via atomic directory creation (portable; no flock needed).
// Returns the lock path on success, or null when another update holds it.
function acquireLock(projectRoot) {
  const lockDir = join(projectRoot, '.paqad', 'locks', 'update.lock');
  try {
    mkdirSync(dirname(lockDir), { recursive: true });
  } catch {
    // ignore
  }
  try {
    mkdirSync(lockDir); // atomic: throws if it already exists
    return lockDir;
  } catch {
    // Reap a lock left behind by a killed run after 60 min, then retry once.
    try {
      const ageMs = Date.now() - statSync(lockDir).mtimeMs;
      if (ageMs > STALE_LOCK_MS) {
        rmdirSync(lockDir);
        mkdirSync(lockDir);
        return lockDir;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

function releaseLock(lockDir) {
  try {
    rmdirSync(lockDir);
  } catch {
    // ignore
  }
}

function appendLine(logPath, line) {
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // best-effort
  }
}

// Force the global upgrade, then resync project artifacts with the new CLI.
// Detached + unref so session start is never blocked (decision D-2).
function spawnBackgroundUpdate(logPath) {
  try {
    const out = openSync(logPath, 'a');
    const child = spawn('npm install -g paqad-ai@latest && paqad-ai update --silent', {
      shell: true,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
  } catch {
    // best-effort
  }
}

try {
  main();
} catch {
  // The hook must never surface an error to the host; always exit cleanly.
}
process.exit(0);
