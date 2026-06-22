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

const DEFAULT_INTERVAL_HOURS = 12;
const STALE_LOCK_MS = 60 * 60 * 1000; // reap a lock left by a killed run after 60 min
const NPM_TIMEOUT_MS = 5000;

function main() {
  const projectRoot =
    process.env.CLAUDE_PROJECT_DIR || process.env.PAQAD_PROJECT_ROOT || process.cwd();
  const versionFile = join(projectRoot, '.paqad', 'framework-version.txt');
  const profileFile = join(projectRoot, '.paqad', 'project-profile.yaml');
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

  // ── Step 2: skip conditions ────────────────────────────────────────────────
  const profile = readFileSafe(profileFile);
  if (profile && /skip_version_check:\s*true/.test(profile)) return; // 2a — opt-out flag

  const intervalHours = resolveIntervalHours(profile); // 2b — interval window
  if (withinInterval(readVersionField(versionFile, 'updated_at'), intervalHours)) return;

  // ── Step 3: fetch latest version from npm (5s timeout) ──────────────────────
  const latest = fetchLatestVersion();
  if (!latest) return;

  // ── Step 4: classify against the two-minor policy ───────────────────────────
  const decision = classify(current, latest);
  const nowIso = new Date().toISOString();
  if (decision === 'current') {
    // Already up to date — reset the interval window.
    touchUpdatedAt(versionFile, current, nowIso);
    return;
  }

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

function resolveIntervalHours(profile) {
  if (!profile) return DEFAULT_INTERVAL_HOURS;
  const match = profile.match(/version_check_interval_hours:\s*(\d+)/);
  return match ? Number(match[1]) : DEFAULT_INTERVAL_HOURS;
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
