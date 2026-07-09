// Path → module sensitivity resolver (issue #324).
//
// A deterministic, no-LLM risk signal: a change whose path maps to a module marked
// `sensitivity: high` in module-map.yml is floored to the full lane. This is the
// path-based floor the pre-code gate applies — cheap (a YAML read + prefix match),
// never a model call. Unknown/normal paths resolve to `normal` (no floor).

import { isAbsolute, relative } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';

import { readRawModuleMap, type ModuleSensitivity } from './reconciler.js';

/** Normalise a source spec or target path to a comparable posix, leading-`./`-free form. */
function normalise(path: string): string {
  return toPosixPath(path).replace(/^\.\//, '').replace(/\/+$/, '');
}

/** True when `target` is the prefix path itself or lives under it. */
function underPrefix(target: string, prefix: string): boolean {
  if (prefix.length === 0) {
    return false;
  }
  return target === prefix || target.startsWith(`${prefix}/`);
}

/**
 * Resolve the change-sensitivity of a single path against module-map.yml. `relPath`
 * may be absolute (a host tool payload) or project-relative; it is normalised to a
 * project-relative posix path before matching. Returns `high` when the path maps to
 * any `sensitivity: high` module (by module or feature source prefix), else `normal`.
 * A missing/unreadable map is `normal` — the floor only ever TIGHTENS, never blocks
 * on its own absence.
 */
export function resolvePathSensitivity(projectRoot: string, relPath: string): ModuleSensitivity {
  const map = readRawModuleMap(projectRoot);
  if (!map) {
    return 'normal';
  }
  const rel = isAbsolute(relPath) ? relative(projectRoot, relPath) : relPath;
  const target = normalise(rel);
  if (target.length === 0) {
    return 'normal';
  }
  for (const mod of map.modules) {
    if (mod.sensitivity !== 'high') {
      continue;
    }
    const prefixes = [...mod.sources, ...mod.features.flatMap((feature) => feature.sources)];
    if (prefixes.some((source) => underPrefix(target, normalise(source)))) {
      return 'high';
    }
  }
  return 'normal';
}
