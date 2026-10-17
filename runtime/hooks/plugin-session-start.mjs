#!/usr/bin/env node
// Claude Code plugin SessionStart bootstrap (issue #616).
//
// This hook runs ONLY under the plugin (it is in runtime/claude-plugin/hooks.json, never the npm
// onboard-time settings), so CLAUDE_PLUGIN_ROOT is always set when it fires for real. It makes the
// plugin self-sufficient at the start of every session:
//   Part 4 — keep ~/.paqad-ai/current pointing at a copy that EXISTS (re-point to the plugin's
//            runtime when the link is missing, dangling, or points at an older npm copy; never
//            replace a real directory; use a Windows junction so no admin is needed).
//   Part 5 — put the plugin's own `paqad-ai` on Claude's shell PATH (via CLAUDE_ENV_FILE) and make
//            the POSIX launcher executable.
// Parts 7 (one-copy handshake) and 9 (version refresh) are layered on later in the same file.
//
// Dist-less and dependency-free (like the other runtime hooks' bootstrap path): it must work before
// any dist is resolvable. It NEVER throws — a plugin bootstrap failure must not wedge the session.

import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import {
  isPluginActiveForSession,
  parseHookPayload,
  resolveProjectRoot,
  writePluginActiveMarker,
} from './lib/paqad-disabled.mjs';

/** The framework link every project's `.paqad/framework-path.txt` resolves to. */
function frameworkHome(env = process.env) {
  return env.PAQAD_FRAMEWORK_HOME || join(homedir(), '.paqad-ai', 'current');
}

/** JUNCTION on Windows (no admin needed), the default symlink elsewhere (issue #616, Part 4). */
function symlinkType() {
  return process.platform === 'win32' ? 'junction' : undefined;
}

/** Read `<dir>/package.json`'s version, or null when absent/unreadable/malformed. */
function readPackageVersion(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Compare two `x.y.z` versions: 1 if a>b, -1 if a<b, 0 if equal/unparseable-equal. */
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

/** lstat without throwing, or undefined when the path does not exist. */
function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

/** The current link's resolved target, or null when the path is not a symlink. */
function linkTarget(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

/**
 * Part 4 — re-point `~/.paqad-ai/current` at the plugin's runtime when the link is missing, its
 * target is gone, or the npm copy it points at is older than the plugin. A link already pointing at
 * the plugin runtime, or at a newer npm copy, is left alone so other tools keep their copy. A real
 * directory at the path is never replaced.
 */
function repointFrameworkLink(pluginRuntime, env = process.env) {
  const home = frameworkHome(env);
  const stat = lstatSafe(home);

  if (stat && stat.isDirectory() && !stat.isSymbolicLink()) {
    return; // a real directory — never replace it (matches bootstrap.ts)
  }

  if (stat && stat.isSymbolicLink()) {
    const target = linkTarget(home);
    if (target) {
      if (target === pluginRuntime) {
        return; // already the plugin runtime
      }
      const targetStat = lstatSafe(target);
      if (targetStat) {
        // Target exists: only take over from an OLDER npm copy; leave a newer one serving others.
        const npmVersion = readPackageVersion(dirname(target));
        const pluginVersion = readPackageVersion(dirname(pluginRuntime));
        if (npmVersion && pluginVersion && compareVersions(npmVersion, pluginVersion) >= 0) {
          return;
        }
      }
      // else: dangling link → fall through and re-point.
    }
  }

  try {
    mkdirSync(dirname(home), { recursive: true });
    rmSync(home, { force: true, recursive: false });
    symlinkSync(pluginRuntime, home, symlinkType());
  } catch {
    /* fail open — a failed re-point must not wedge the session */
  }
}

/**
 * Part 5 — make the plugin's `paqad-ai` the one Claude Code runs. chmod the POSIX launcher (the npm
 * tarball may drop the executable bit) and prepend its directory to the session shell's PATH via a
 * plain assignment line in CLAUDE_ENV_FILE (plain, not `export`, so PowerShell reads it too).
 */
function ensureBinOnPath(pluginRuntime, env = process.env) {
  const binDir = join(pluginRuntime, 'claude-plugin', 'bin');
  if (process.platform !== 'win32') {
    try {
      chmodSync(join(binDir, 'paqad-ai'), 0o755);
    } catch {
      /* best-effort: a missing/again-read-only launcher must not wedge the session */
    }
  }
  const envFile = env.CLAUDE_ENV_FILE;
  if (typeof envFile === 'string' && envFile.length > 0) {
    try {
      appendFileSync(envFile, `PATH=${binDir}${delimiter}${env.PATH ?? ''}\n`);
    } catch {
      /* best-effort */
    }
  }
}

/** The six stage-agent files the npm copy writes under ~/.claude/agents/ (issue #616, Part 7). */
const HOME_STAGE_AGENTS = [
  'paqad-planning.md',
  'paqad-specification.md',
  'paqad-development.md',
  'paqad-review.md',
  'paqad-checks.md',
  'paqad-documentation-sync.md',
];

/** Claude Code's config dir — honours CLAUDE_CONFIG_DIR (set by the host), else ~/.claude. */
function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}
function claudeSettingsPath(env = process.env) {
  return join(claudeDir(env), 'settings.json');
}
function claudeAgentsDir(env = process.env) {
  return join(claudeDir(env), 'agents');
}

/** The absolute `.mjs` script path a paqad hook command runs, or null when it is not a paqad hook. */
function paqadHookScriptPath(command) {
  if (typeof command !== 'string' || !command.includes('paqad')) return null;
  const m = command.match(/"([^"]+\.mjs)"|(\S+\.mjs)/);
  const path = m ? (m[1] ?? m[2]) : null;
  return path && path.includes('paqad') ? path : null;
}

/** Walk every hook command in a parsed settings object, yielding [eventKey, index, command]. */
function eachHookCommand(settings) {
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

/**
 * Part 7 — true when ~/.claude/settings.json still wires a LIVE paqad hook: one whose `.mjs`
 * script exists on disk. A live npm copy owns the session, so the plugin stays passive.
 */
function hasLiveNpmHookLines(settingsPath = claudeSettingsPath()) {
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

/**
 * Part 7 — prune DEAD paqad hook lines (their `.mjs` script is gone, e.g. the npm copy was
 * uninstalled) from ~/.claude/settings.json, so stale wiring never fires. Live lines are kept.
 */
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
        if (script === null) return true; // not a paqad hook — leave it
        return existsSync(script); // paqad hook: keep only when its script still exists
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
    } catch {
      /* best-effort */
    }
  }
}

/** Part 7 — remove the six `~/.claude/agents/paqad-*.md` the npm copy wrote; the plugin ships its own. */
function removeHomeStageAgents(agentsDir = claudeAgentsDir()) {
  for (const name of HOME_STAGE_AGENTS) {
    try {
      rmSync(join(agentsDir, name), { force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ─── Part 9 (issue #616, FR-15): keep the version file current ────────────────────────────────────
//
// When the plugin is newer than the project's recorded framework-version, run `update --silent` in
// the background (the plugin's OWN CLI, under a single-flight lock) so the project's managed
// artifacts track the plugin. It never downgrades, never blocks, and never prints.

const UPDATE_THROTTLE_MS = 6 * 60 * 60 * 1000; // at most one background refresh per 6h

/** The version recorded in `.paqad/framework-version.txt`, or null when absent/unreadable. */
function frameworkVersionTxtVersion(projectRoot) {
  try {
    const txt = readFileSync(join(projectRoot, '.paqad', 'framework-version.txt'), 'utf8');
    const m = txt.match(/^version=(.*)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/** True when the plugin is newer than the recorded framework version (never downgrade). */
function shouldRefreshVersion(pluginVersion, frameworkVersion) {
  if (!pluginVersion) return false;
  if (!frameworkVersion) return true; // nothing recorded yet → let the update seed it
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

/**
 * Part 9 — refresh the project's framework artifacts in the background when the plugin is newer than
 * the recorded version, under a single-flight lock throttled to {@link UPDATE_THROTTLE_MS}.
 */
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

export function runPluginSessionStart(env = process.env, payload = undefined) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    return; // not running as a plugin (e.g. imported by a test without the env set)
  }
  const pluginRuntime = join(pluginRoot, 'runtime');
  // Part 4 — always safe (only re-points a missing/dangling/older link).
  repointFrameworkLink(pluginRuntime, env);

  // Part 7 — the one-copy handshake. Stay passive only when THIS session is not already claimed
  // AND a live npm copy is still wired to run its own hooks; otherwise the plugin claims the
  // session (INV-4 fails safe to active). A claimed session re-runs the idempotent cleanup.
  if (!isPluginActiveForSession(payload, env) && hasLiveNpmHookLines(claudeSettingsPath(env))) {
    return;
  }
  writePluginActiveMarker(payload, env);
  ensureBinOnPath(pluginRuntime, env); // Part 5
  removeDeadNpmHookLines(claudeSettingsPath(env));
  removeHomeStageAgents(claudeAgentsDir(env));
  maybeRefreshVersion(pluginRoot, resolveProjectRoot(env, payload)); // Part 9
}

// Exported for unit tests; the internal helpers are re-exported so each branch is testable without
// mutating the real home directory.
export const __test = {
  compareVersions,
  readPackageVersion,
  repointFrameworkLink,
  ensureBinOnPath,
  frameworkHome,
  symlinkType,
  hasLiveNpmHookLines,
  removeDeadNpmHookLines,
  removeHomeStageAgents,
  paqadHookScriptPath,
  claudeDir,
  shouldRefreshVersion,
  frameworkVersionTxtVersion,
  maybeRefreshVersion,
};

// Run when invoked as the hook entry (not when imported by a test).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    let payload;
    try {
      payload = parseHookPayload(readFileSync(0, 'utf8'));
    } catch {
      payload = undefined;
    }
    runPluginSessionStart(process.env, payload);
  } catch {
    /* fail open */
  }
}
