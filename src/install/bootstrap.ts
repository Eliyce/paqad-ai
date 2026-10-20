import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { setEngineLogger } from '@/core/logger-registry.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { ensureSchemaMarkerSync } from '@/core/schema-version.js';
import type { EngineLogger } from '@/core/types/logger.js';
import { VERSION } from '@/index.js';
import {
  resolveFrameworkInstallPath,
  writeFrameworkMetadata,
} from '@/onboarding/manifest-writer.js';
import { writeStageAgents } from '@/stage-isolation/agent-writer.js';

export interface InstallResult {
  framework_home: string;
  project_root: string;
  version: string;
}

/** Options for {@link bootstrapFramework}. */
export interface BootstrapOptions {
  /**
   * A consumer logger to install at init (PQD-105). When supplied, every
   * structured log the engine emits is routed to it. Equivalent to calling
   * {@link setEngineLogger} before bootstrapping; provided here so the consumer
   * has a single clean init surface.
   */
  logger?: EngineLogger;
}

/**
 * The HOME-ONLY half of the install: create the `~/.paqad-ai/current` framework symlink and
 * render the six stage-isolation agents under the user home. It writes NOTHING into the project,
 * so a caller that must not touch the tracked tree (issue #576, Finding 2 — `paqad-ai join`) can
 * set up a fresh machine's global install without producing a diff. {@link bootstrapFramework}
 * layers the project-side metadata writes on top for `onboard`/`install`.
 */
export function bootstrapFrameworkHome(): { framework_home: string } {
  const frameworkHome = resolveFrameworkInstallPath();
  const runtimeRoot = getRuntimeRoot();

  ensureFrameworkSymlink(runtimeRoot, frameworkHome);

  // Issue #567 — render the six stage agents at user scope (~/.claude/agents, ~/.codex/agents).
  // Stage isolation is core-engine behavior (no config knob), so this always runs; it never
  // writes into the project. Best-effort: a render/write failure must not fail the install (the
  // agents are inert until the orchestrator dispatches them, and the next update retries).
  try {
    writeStageAgents();
  } catch {
    /* best-effort: stage-agent generation never blocks install/update */
  }

  return { framework_home: frameworkHome };
}

export function bootstrapFramework(projectRoot: string, options?: BootstrapOptions): InstallResult {
  if (options?.logger !== undefined) {
    setEngineLogger(options.logger);
  }

  const { framework_home: frameworkHome } = bootstrapFrameworkHome();

  writeFrameworkMetadata(projectRoot, VERSION);

  // PQD-95 — ensure the cross-artifact schema marker exists so every freshly
  // bootstrapped project carries the `.paqad/` layout version. Idempotent: an
  // existing marker is left untouched (migration is checkAndMigrateSchema's job).
  ensureSchemaMarkerSync(projectRoot, VERSION);

  return {
    framework_home: frameworkHome,
    project_root: projectRoot,
    version: VERSION,
  };
}

function ensureFrameworkSymlink(
  runtimeRoot: string,
  frameworkHome: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  mkdirSync(dirname(frameworkHome), { recursive: true });

  // Issue #641 (Gap 1) — when `onboard`/`install`/`join` run from the plugin bin, apply the
  // SAME plugin-safe rule the plugin's SessionStart already follows: never take over a link
  // that resolves to a working npm install, only fill a missing/dangling link, and point it
  // at the stable `${CLAUDE_PLUGIN_DATA}/runtime` location (not the version-specific cache
  // runtime). Running from the npm install keeps the existing behaviour below untouched.
  if (isPluginRuntime(env)) {
    repointFrameworkLinkPluginAware(runtimeRoot, frameworkHome, env);
    return;
  }

  if (isExpectedRuntimeSymlink(runtimeRoot, frameworkHome)) {
    return;
  }

  removeConflictingFrameworkPath(frameworkHome);

  try {
    symlinkSync(runtimeRoot, frameworkHome, frameworkSymlinkType());
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'EEXIST' &&
      isExpectedRuntimeSymlink(runtimeRoot, frameworkHome)
    ) {
      return;
    }
    throw error;
  }
}

// ── Plugin-aware framework-link rule (issue #641, Gap 1) ─────────────────────
//
// This is the TypeScript MIRROR of `repointFrameworkLink` and its helpers in
// `runtime/hooks/plugin-session-start.mjs`. The `.mjs` runtime hooks are deliberately
// dist-less and dependency-free (they run before any dist is resolvable), so the hook cannot
// import this compiled module and this module cannot import the hook. Decision
// D-01M55NZYS2JA2B6PNPVQN5X694 chose to mirror the rule in both files rather than share one
// implementation; `tests/unit/install/bootstrap-plugin-link.test.ts` drives both copies over
// the same fixtures and asserts they make the identical link decision (spec #641 INV-4).

/**
 * True when the running runtime is a Claude Code plugin runtime, i.e. `CLAUDE_PLUGIN_ROOT` is
 * set. When it is, `getRuntimeRoot()` already resolves to `${CLAUDE_PLUGIN_ROOT}/runtime`, which
 * is exactly the `.mjs` hook's `pluginRuntime`, so the second "getRuntimeRoot() is under
 * CLAUDE_PLUGIN_ROOT" clause in the spec is subsumed by this one.
 */
function isPluginRuntime(env: NodeJS.ProcessEnv): boolean {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  return typeof pluginRoot === 'string' && pluginRoot.length > 0;
}

/** True when a resolved runtime path belongs to an npm install (lives under a node_modules tree). */
function isNpmRuntime(target: string): boolean {
  return target.includes('node_modules');
}

/** True when a resolved runtime path belongs to a Claude Code plugin cache (lives under …/plugins/…). */
function isPluginCacheRuntime(target: string): boolean {
  return target.includes('/plugins/') || target.includes('\\plugins\\');
}

/**
 * The stable, version-independent location the plugin keeps pointing at its current runtime,
 * or null when `CLAUDE_PLUGIN_DATA` is unset (then the shared link falls back to the cache
 * runtime directly). Mirrors `stableRuntimeHome` in the `.mjs` hook.
 */
function stableRuntimeHome(env: NodeJS.ProcessEnv): string | null {
  const data = env.CLAUDE_PLUGIN_DATA;
  return typeof data === 'string' && data.length > 0 ? join(data, 'runtime') : null;
}

/** The current link's resolved target, or null when the path is not a symlink. */
function linkTarget(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

const RUNTIME_COPY_PARTS = ['package.json', 'dist', 'runtime'] as const;

function readPluginVersion(pluginRoot: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : null;
  } catch {
    return null;
  }
}

function runtimeCopyVersion(copyRoot: string): string | null {
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

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function removeTreeQuietly(path: string): void {
  try {
    removeTree(path);
  } catch {
    return;
  }
}

function replaceRuntimeCopy(staging: string, copyRoot: string): void {
  const st = lstatSafe(copyRoot);
  let retired: string | null = null;
  if (st && st.isSymbolicLink()) {
    rmSync(copyRoot, { force: true, recursive: false });
  } else if (st) {
    retired = `${copyRoot}.old-${process.pid}`;
    removeTree(retired);
    renameWithRetrySync(copyRoot, retired, { remove: () => undefined });
  }
  renameWithRetrySync(staging, copyRoot, { remove: removeTreeQuietly });
  if (retired) {
    removeTreeQuietly(retired);
  }
}

function ensureStablePluginRuntime(pluginRuntime: string, env: NodeJS.ProcessEnv): string {
  const copyRoot = stableRuntimeHome(env);
  if (!copyRoot) {
    return pluginRuntime;
  }
  const pluginRoot = dirname(pluginRuntime);
  const linked = join(copyRoot, 'runtime');
  const staging = `${copyRoot}.tmp-${process.pid}`;
  try {
    const version = readPluginVersion(pluginRoot);
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

/**
 * The plugin-safe framework-link rule, mirroring `repointFrameworkLink` in the `.mjs` hook. A
 * real directory is never replaced; a link resolving to a working npm install is never taken
 * over; an unknown working directory is left alone; only the plugin's own earlier cache
 * takeover, the plugin runtime itself, or a missing/dangling link is (re)pointed at the stable
 * location. Best-effort — a failed re-point must not fail the install.
 */
function repointFrameworkLinkPluginAware(
  pluginRuntime: string,
  frameworkHome: string,
  env: NodeJS.ProcessEnv,
): void {
  const stat = lstatSafe(frameworkHome);

  if (stat && stat.isDirectory() && !stat.isSymbolicLink()) {
    return; // a real directory — never replace it
  }

  const stable = ensureStablePluginRuntime(pluginRuntime, env);

  if (stat && stat.isSymbolicLink()) {
    const target = linkTarget(frameworkHome);
    if (target) {
      if (target === stable) {
        return; // already pointing at our stable location
      }
      const targetStat = lstatSafe(target);
      if (targetStat && target !== stableRuntimeHome(env)) {
        // Resolves to a working copy. NEVER take over a working npm install — it keeps serving
        // every host. Leave an unknown working directory alone too; only a working plugin-cache
        // target (an earlier takeover) or the plugin runtime itself is refreshed to the stable
        // location below.
        if (isNpmRuntime(target)) {
          return;
        }
        if (!isPluginCacheRuntime(target) && target !== pluginRuntime) {
          return;
        }
      }
      // else: dangling link (target gone) → fall through and re-point to the stable location.
    }
  }

  try {
    mkdirSync(dirname(frameworkHome), { recursive: true });
    rmSync(frameworkHome, { force: true, recursive: false });
    symlinkSync(stable, frameworkHome, frameworkSymlinkType());
  } catch {
    /* fail open — a failed re-point must not fail the install */
  }
}

/**
 * The symlink type for the framework link. On Windows a plain directory symlink needs Developer
 * Mode or admin and throws EPERM otherwise, so use a JUNCTION there — it needs neither, and points
 * at a directory just the same (issue #616, Part 4; the plugin's SessionStart uses the same rule).
 * POSIX passes `undefined`, the default. `symlinkSync` ignores the type argument on POSIX.
 */
export function frameworkSymlinkType(): 'junction' | undefined {
  return process.platform === 'win32' ? 'junction' : undefined;
}

function removeConflictingFrameworkPath(frameworkHome: string): void {
  // Use lstat, not existsSync: existsSync follows symlinks, so a dangling link
  // (e.g. the npx cache dir it pointed at was garbage-collected between runs)
  // reads as "absent" — skipping cleanup and crashing symlinkSync with EEXIST.
  const stat = lstatSafe(frameworkHome);
  if (stat === undefined) {
    return;
  }

  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new Error(
      `Refusing to replace existing framework home directory at ${frameworkHome}. Remove it manually or point PAQAD_FRAMEWORK_HOME at an empty path.`,
    );
  }

  rmSync(frameworkHome, { force: true, recursive: false });
}

function isExpectedRuntimeSymlink(runtimeRoot: string, frameworkHome: string): boolean {
  const stat = lstatSafe(frameworkHome);
  if (stat === undefined || !stat.isSymbolicLink()) {
    return false;
  }

  try {
    return readlinkSync(frameworkHome) === runtimeRoot;
  } catch {
    return false;
  }
}

/** lstat that returns undefined instead of throwing when the path is absent. */
function lstatSafe(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

// Exported for the #641 TS/.mjs consistency test (spec INV-4) so the mirrored plugin-link
// rule can be driven over the same fixtures as the `.mjs` `repointFrameworkLink` without
// mutating the real home directory. Not part of the public install API.
export const __test = {
  ensureFrameworkSymlink,
  isPluginRuntime,
  repointFrameworkLinkPluginAware,
  ensureStablePluginRuntime,
  stableRuntimeHome,
  isNpmRuntime,
  isPluginCacheRuntime,
};
