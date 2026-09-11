// Ecosystem-lockfile presence lookup for a runner's parallel prerequisite (issue #554, Part B.2).
//
// A runner's `parallel.requires_package` (e.g. `brianium/paratest`, `pytest-xdist`) only enables
// the parallel mode when the project actually has it installed. paqad never installs it — a
// missing prerequisite degrades to the sequential command (INV-5). This module answers "is the
// package in the project's lockfile?" deterministically, returning `null` (unknown) when no
// lockfile of that ecosystem is present so the caller can record `unknown` rather than a false no.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PackageEcosystem = 'composer' | 'python' | 'node' | 'ruby';

/** Candidate lockfiles per ecosystem, in the order they are consulted. */
const ECOSYSTEM_FILES: Record<PackageEcosystem, string[]> = {
  composer: ['composer.lock'],
  python: ['poetry.lock', 'uv.lock', 'Pipfile.lock', 'pyproject.toml'],
  node: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock'],
  ruby: ['Gemfile.lock'],
};

/** `requirements*.txt` for python is a glob, resolved separately. */
const PYTHON_REQUIREMENTS = /^requirements.*\.txt$/i;

/** Normalize a package name for a tolerant compare: lowercase, `-` and `_` equivalent. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}

/** Read a file if present, else null. */
function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    /* v8 ignore next -- unreadable-but-present lockfile degrades to "not found here", never throws */
    return null;
  }
}

/** composer.lock names live in `packages[]` / `packages-dev[]` `name` fields — match exactly. */
function composerHas(content: string, name: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  const target = normalize(name);
  const buckets = ['packages', 'packages-dev'] as const;
  for (const bucket of buckets) {
    const list = (parsed as Record<string, unknown>)?.[bucket];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const entryName = (entry as Record<string, unknown>)?.name;
      if (typeof entryName === 'string' && normalize(entryName) === target) return true;
    }
  }
  return false;
}

/**
 * Whether `name` is present in the project's `ecosystem` lockfile(s). Returns `true`/`false` when
 * a lockfile exists, and `null` when none of the ecosystem's lockfiles are present (unknown).
 * Deterministic — reads files, never runs a package manager.
 */
export function hasPackage(
  projectRoot: string,
  ecosystem: PackageEcosystem,
  name: string,
): boolean | null {
  const candidates = ECOSYSTEM_FILES[ecosystem].map((file) => join(projectRoot, file));

  if (ecosystem === 'python') {
    // requirements*.txt is a glob — add any that exist.
    try {
      for (const entry of readdirSync(projectRoot)) {
        if (PYTHON_REQUIREMENTS.test(entry)) candidates.push(join(projectRoot, entry));
      }
    } catch {
      /* v8 ignore next -- an unreadable project root just means no extra requirements files */
    }
  }

  const present = candidates.map((path) => ({ path, content: readIfPresent(path) }));
  const found = present.filter((entry) => entry.content !== null);
  if (found.length === 0) return null;

  const target = normalize(name);
  for (const entry of found) {
    if (ecosystem === 'composer') {
      if (composerHas(entry.content!, name)) return true;
    } else if (normalize(entry.content!).includes(target)) {
      return true;
    }
  }
  return false;
}
