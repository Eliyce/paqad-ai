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
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

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

export function runPluginSessionStart(env = process.env) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    return; // not running as a plugin (e.g. imported by a test without the env set)
  }
  const pluginRuntime = join(pluginRoot, 'runtime');
  repointFrameworkLink(pluginRuntime, env);
  ensureBinOnPath(pluginRuntime, env);
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
};

// Run when invoked as the hook entry (not when imported by a test).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    runPluginSessionStart();
  } catch {
    /* fail open */
  }
}
