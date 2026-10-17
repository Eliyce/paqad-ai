// On-demand optional-engine resolution (issue #616, Part 2b, FR-4).
//
// The Claude Code plugin ships `dist/` with NO `node_modules`, so the heavy, optional engines —
// `@huggingface/transformers` (local embeddings + reranking) and the remote clients `openai` /
// `voyageai` — cannot be found by a bare import the way they are under an npm install. This module
// resolves them from three places, in order:
//
//   1. normal resolution, next to this module (dev + every npm install);
//   2. the plugin's own writable data dir, `${CLAUDE_PLUGIN_DATA}/node_modules`;
//   3. the npm copy's `node_modules` — one level above the framework runtime link
//      (`realpath(~/.paqad-ai/current)/../node_modules`), then the global install
//      (`npm root -g`/paqad-ai/node_modules).
//
// Hop 1 (normal resolution) goes through a bare dynamic `import(name)` — the dev/npm path, the
// one that yields ESM named exports, and the one a test's module mock intercepts. Hops 2 and 3
// go through `createRequire`, which returns the package's `require`-condition entry whose named
// exports survive `require()` (a dynamic `import()` of the same CJS entry drops them). Every lazy
// import of the three engines routes through `loadOptionalPackage`, so a plugin with no local
// `node_modules` still finds an engine the npm copy already carries, and degrades to the text-
// search / heuristic fallback (never a crash) when none of the three resolve.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { frameworkLinkHome } from '@/health/plugin-install.js';

/**
 * createRequire base files for the NON-normal locations (hops 2 and 3), whose directories'
 * `node_modules` are searched after a bare import fails. Hop 1 is the bare import itself.
 */
function alternateBases(env: NodeJS.ProcessEnv): string[] {
  const bases: string[] = [];

  // Hop 2: the plugin's writable data dir (where the on-demand install lands).
  const pluginData = env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    bases.push(join(pluginData, 'package.json'));
  }

  // Hop 3a: the npm copy's node_modules, one level above the framework runtime link.
  try {
    const runtimeReal = realpathSync(frameworkLinkHome(env));
    bases.push(join(dirname(runtimeReal), 'package.json'));
  } catch {
    // The link is missing or dangling — skip this candidate.
  }

  // Hop 3b: the global install's own node_modules (cold path — only reached when every
  // hop above missed, and resolution is called at most once per engine load).
  /* v8 ignore next 3 -- npm is present in this repo's env so npmGlobalRoot is non-null here; the absent-npm branch guards other hosts. */
  const globalRoot = npmGlobalRoot();
  if (globalRoot) {
    bases.push(join(globalRoot, 'paqad-ai', 'package.json'));
  }

  return bases;
}

/** `npm root -g`, or null when npm is unavailable. Spawned only on the cold resolution path. */
function npmGlobalRoot(): string | null {
  try {
    const out = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    /* v8 ignore next -- npm always prints a path in this repo's env; the empty-output guard is defensive. */
    return out.length > 0 ? out : null;
    /* v8 ignore start -- npm is present in this repo's test env; this guards hosts without npm on PATH. */
  } catch {
    return null;
  }
  /* v8 ignore stop */
}

/**
 * Resolve an optional engine's entry path, searching the three locations in order, or null when
 * none carries it. Used by the on-demand install and `doctor` to decide whether an engine is
 * present; the hot load path is {@link loadOptionalPackage}. Hop 1 resolves next to this module.
 */
export function resolveOptionalPackage(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const base of [import.meta.url, ...alternateBases(env)]) {
    try {
      return createRequire(base).resolve(name);
    } catch {
      // Not under this base — try the next location.
    }
  }
  return null;
}

/**
 * Load an optional engine by name. Tries a bare dynamic import first (the dev/npm path, with its
 * ESM named exports, and the path a test's module mock intercepts); on failure it searches the
 * plugin data dir and the npm copy via `require`, whose named exports survive loading a CJS entry.
 * Throws when the engine is installed nowhere — callers catch that and fall back to text search /
 * the token heuristic.
 */
export async function loadOptionalPackage<T = unknown>(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  try {
    return (await import(name)) as T;
  } catch {
    // Not resolvable next to dist (the plugin case) — try the plugin/npm-copy locations.
  }
  for (const base of alternateBases(env)) {
    try {
      return createRequire(base)(name) as T;
    } catch {
      // Not under this base — try the next location.
    }
  }
  // The engine resolved nowhere and (since this loader is only reached from the RAG/context
  // seams) RAG is in use — kick off the one-time background install, then let the caller fall
  // back to text search / the token heuristic. The install is a no-op outside a plugin.
  /* v8 ignore start -- best-effort kick-off; its internals already fail safe, so this catch rarely fires. */
  try {
    maybeStartOptionalEngineInstall(env);
  } catch {
    // Provisioning is best-effort; never let it mask the real "engine missing" failure.
  }
  /* v8 ignore stop */
  throw new Error(`optional package ${name} is not installed`);
}

// ─── On-demand engine install (issue #616, Part 2b, FR-4/FR-5) ──────────────────────────────────
//
// In the plugin (no local node_modules), the first time RAG needs an engine that resolves nowhere,
// paqad installs the heavy engines into the plugin's own writable data dir in the background: a
// detached `npm install`, version-pinned to the ranges in the shipped package.json (never `latest`),
// single-flight locked, retried at most once per 24h, logging to a file and writing a status marker.
// It never blocks the hook and never prints. While it runs, retrieval stays on the text-search
// fallback; `doctor` reads the marker to report ready / installing / install failed.

/** The heavy optional engines the on-demand install provisions. */
const OPTIONAL_ENGINES = ['@huggingface/transformers', 'openai', 'voyageai'] as const;

/** The engine whose presence decides the doctor "ready" state (the default local provider). */
const PRIMARY_ENGINE = '@huggingface/transformers';

/** At most one install attempt per day (success or failure). */
const INSTALL_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The verbatim hint doctor prints when the background engine install has failed. */
export const ENGINE_INSTALL_NETWORK_HINT =
  'If this machine is offline or behind a proxy, install the engine manually: run ' +
  '`npm install @huggingface/transformers` inside the CLAUDE_PLUGIN_DATA directory.';

interface EnginePaths {
  readonly marker: string;
  readonly lock: string;
  readonly log: string;
}

function enginePaths(pluginData: string): EnginePaths {
  return {
    marker: join(pluginData, '.paqad-engine-install.json'),
    lock: join(pluginData, '.paqad-engine-install.lock'),
    log: join(pluginData, '.paqad-engine-install.log'),
  };
}

interface InstallMarker {
  status: 'installing' | 'ready' | 'failed';
  attempted_at: string;
  error?: string;
}

function readInstallMarker(markerPath: string): InstallMarker | null {
  try {
    return JSON.parse(readFileSync(markerPath, 'utf8')) as InstallMarker;
  } catch {
    return null;
  }
}

/** `name@range` for each optional engine, read from the paqad package.json above the runtime link. */
function readEngineSpecs(env: NodeJS.ProcessEnv): string[] {
  try {
    const pkgRoot = dirname(realpathSync(frameworkLinkHome(env)));
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    const specs: string[] = [];
    for (const name of OPTIONAL_ENGINES) {
      const range = deps[name];
      if (typeof range === 'string' && range.length > 0) {
        specs.push(`${name}@${range}`);
      }
    }
    return specs;
  } catch {
    return [];
  }
}

/** The outcome of a single {@link maybeStartOptionalEngineInstall} call. */
export type EngineInstallOutcome =
  | 'started'
  | 'already-present'
  | 'in-progress'
  | 'throttled'
  | 'no-plugin-data'
  | 'no-pinned-range';

/** Injectable seams so the decision logic is testable without spawning a real install. */
export interface EngineInstallDeps {
  now?: () => number;
  resolve?: (name: string, env: NodeJS.ProcessEnv) => string | null;
  readSpecs?: (env: NodeJS.ProcessEnv) => string[];
  startInstall?: (specs: string[], dir: string, paths: EnginePaths) => void;
}

/**
 * Start the background engine install when it is warranted, else report why it was skipped. Only
 * runs inside a plugin (`CLAUDE_PLUGIN_DATA` set), only when the engine resolves nowhere, only one
 * attempt at a time (lock), and only once per {@link INSTALL_RETRY_INTERVAL_MS}. Pinned to the
 * package.json ranges — with no readable range it declines rather than installing `latest`.
 */
export function maybeStartOptionalEngineInstall(
  env: NodeJS.ProcessEnv = process.env,
  deps: EngineInstallDeps = {},
): EngineInstallOutcome {
  const pluginData = env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) {
    return 'no-plugin-data';
  }
  const resolve = deps.resolve ?? resolveOptionalPackage;
  if (resolve(PRIMARY_ENGINE, env) !== null) {
    return 'already-present';
  }
  const paths = enginePaths(pluginData);
  const marker = readInstallMarker(paths.marker);
  if (marker?.status === 'installing' && existsSync(paths.lock)) {
    return 'in-progress';
  }
  const now = deps.now ?? Date.now;
  if (marker && now() - Date.parse(marker.attempted_at) < INSTALL_RETRY_INTERVAL_MS) {
    return 'throttled';
  }
  const specs = (deps.readSpecs ?? readEngineSpecs)(env);
  if (specs.length === 0) {
    return 'no-pinned-range';
  }
  mkdirSync(pluginData, { recursive: true });
  // A private package.json marks the dir as its own npm root (same as visual-evidence provisioning).
  writeFileSync(
    join(pluginData, 'package.json'),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  writeFileSync(paths.lock, String(process.pid));
  writeFileSync(
    paths.marker,
    JSON.stringify({ status: 'installing', attempted_at: new Date(now()).toISOString() }),
  );
  /* v8 ignore next -- the real spawn default is exercised under manual-scenario sign-off, not units. */
  (deps.startInstall ?? spawnEngineInstall)(specs, pluginData, paths);
  return 'started';
}

/* v8 ignore start -- spawns a real detached `npm install`; the decision logic around it is unit
   tested through the injected startInstall seam, and the install itself is covered by manual
   scenario sign-off (the pentest-engine / visual-evidence provisioning precedent). */
function spawnEngineInstall(specs: string[], dir: string, paths: EnginePaths): void {
  // The parent hook exits immediately, so the detached child runs the install itself and writes
  // the ready/failed marker + clears the lock on its own. Args are tokenized; no shell.
  const installer = `
    const { execFileSync } = require('node:child_process');
    const { openSync, writeFileSync, rmSync } = require('node:fs');
    const specs = process.env.PAQAD_ENGINE_SPECS.split(' ');
    try {
      const fd = openSync(process.env.PAQAD_ENGINE_LOG, 'a');
      execFileSync('npm', ['install', ...specs, '--no-audit', '--no-fund', '--omit=dev'], {
        cwd: process.env.PAQAD_ENGINE_DIR, stdio: ['ignore', fd, fd],
      });
      writeFileSync(process.env.PAQAD_ENGINE_MARKER, JSON.stringify({ status: 'ready', attempted_at: new Date().toISOString() }));
    } catch (e) {
      const msg = String(e && e.message ? e.message : e).split('\\n')[0];
      writeFileSync(process.env.PAQAD_ENGINE_MARKER, JSON.stringify({ status: 'failed', attempted_at: new Date().toISOString(), error: msg }));
    } finally {
      try { rmSync(process.env.PAQAD_ENGINE_LOCK); } catch {}
    }
  `;
  const child = spawn(process.execPath, ['-e', installer], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      PAQAD_ENGINE_SPECS: specs.join(' '),
      PAQAD_ENGINE_DIR: dir,
      PAQAD_ENGINE_LOG: paths.log,
      PAQAD_ENGINE_MARKER: paths.marker,
      PAQAD_ENGINE_LOCK: paths.lock,
    },
  });
  child.unref();
}
/* v8 ignore stop */

/** The doctor-facing state of the optional embedding engine. */
export type OptionalEngineState = 'ready' | 'installing' | 'install failed' | 'not installed';

export interface OptionalEngineReport {
  state: OptionalEngineState;
  /** First line of the npm error, when the install failed. */
  detail?: string;
  /** The verbatim network-fix hint, when the install failed. */
  hint?: string;
}

/** Injectable seam so doctor-state reporting is testable without touching the real install dir. */
export interface OptionalEngineReportDeps {
  resolve?: (name: string, env: NodeJS.ProcessEnv) => string | null;
}

/**
 * Report the optional engine's state for `doctor`: `ready` when it resolves anywhere, else the
 * background install's marker (`installing` / `install failed: <first npm error line>` + the
 * network hint), else `not installed`.
 */
export function describeOptionalEngine(
  env: NodeJS.ProcessEnv = process.env,
  deps: OptionalEngineReportDeps = {},
): OptionalEngineReport {
  const resolve = deps.resolve ?? resolveOptionalPackage;
  if (resolve(PRIMARY_ENGINE, env) !== null) {
    return { state: 'ready' };
  }
  const pluginData = env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    const marker = readInstallMarker(enginePaths(pluginData).marker);
    if (marker?.status === 'installing') {
      return { state: 'installing' };
    }
    if (marker?.status === 'failed') {
      return {
        state: 'install failed',
        detail: (marker.error ?? '').split('\n')[0],
        hint: ENGINE_INSTALL_NETWORK_HINT,
      };
    }
  }
  return { state: 'not installed' };
}
