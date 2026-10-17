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

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
    /* v8 ignore next 3 -- npm is always present in this repo's own test environment, so the
       spawn-failure branch is unreachable here; it guards hosts without npm on PATH. */
  } catch {
    return null;
  }
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
  throw new Error(`optional package ${name} is not installed`);
}
