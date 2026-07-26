// Resolving what is ACTUALLY installed, for the node ecosystem (issue #397).
//
// The stack snapshot cannot answer this. Its `locked_version` mirrors the manifest range
// (`^19.0.0`) rather than a resolved pin, so a claim checked against it is checked against
// a range, not against the code on disk. The truth lives in the installed package's own
// manifest, which is what these helpers read (FR-2).
//
// Everything here reads the ONBOARDED PROJECT's node_modules, never paqad-ai's own
// (INV-6): the verdict has to describe the versions the developer's plan will run against.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** A package's manifest, narrowed to the fields declaration resolution needs. */
interface PackageManifest {
  version?: string;
  types?: string;
  typings?: string;
  main?: string;
  exports?: unknown;
}

/** Where an installed package lives, and the version its own manifest declares. */
export interface InstalledLocation {
  dir: string;
  version: string;
}

function readManifest(packageDir: string): PackageManifest | null {
  try {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Locate `packageName` in the install tree under `searchRoot` and read its resolved
 * version. Returns null when the package is declared but not installed — a real state
 * after a manifest edit without an install, and one the index records as `not-installed`
 * rather than guessing.
 *
 * `searchRoot` is the manifest root the dependency was declared under, not necessarily the
 * project root: a monorepo installs its framework beside the sub-app that declares it.
 */
export function resolveInstalledVersion(
  searchRoot: string,
  packageName: string,
): InstalledLocation | null {
  const dir = join(searchRoot, 'node_modules', packageName);
  const manifest = readManifest(dir);
  if (!manifest || typeof manifest.version !== 'string' || manifest.version.length === 0) {
    return null;
  }
  return { dir, version: manifest.version };
}

/**
 * The `@types/<pkg>` directory name for a package, following the DefinitelyTyped
 * convention where a scoped `@scope/name` becomes `@types/scope__name`.
 */
export function typesPackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    return `@types/${packageName.slice(1).replace('/', '__')}`;
  }
  return `@types/${packageName}`;
}

/**
 * Pull a declaration path out of an `exports` entry. The condition tree is walked for a
 * `types` key at any depth, because real packages nest it under version-gated conditions
 * (`@types/react` ships `{"types@<=5.0": {...}, "types": {"default": "./index.d.ts"}}`).
 * The FIRST plain `types` condition wins, so a version-gated legacy variant never
 * outranks the current one.
 */
export function typesFromExports(exportsField: unknown): string | null {
  if (typeof exportsField === 'string') {
    return exportsField.endsWith('.d.ts') ? exportsField : null;
  }
  if (typeof exportsField !== 'object' || exportsField === null || Array.isArray(exportsField)) {
    return null;
  }
  const entry = exportsField as Record<string, unknown>;
  // The root subpath first: a package's own "." entry is the one a bare import resolves to.
  if (entry['.'] !== undefined) {
    const root = typesFromExports(entry['.']);
    if (root !== null) {
      return root;
    }
  }
  if (typeof entry.types === 'string') {
    return entry.types;
  }
  if (entry.types !== undefined) {
    const nested = typesFromExports(entry.types);
    if (nested !== null) {
      return nested;
    }
  }
  if (typeof entry.default === 'string' && entry.default.endsWith('.d.ts')) {
    return entry.default;
  }
  return null;
}

/**
 * The absolute path to a package's declaration entry, or null when it ships none.
 *
 * Order: the package's own `types`/`typings`, then its `exports` condition tree, then a
 * conventional `index.d.ts`, then the `@types/<pkg>` companion in the same install tree.
 * React is the case that needs the last hop — `react` itself ships no declarations;
 * `@types/react` does.
 */
export function resolveTypesEntry(
  searchRoot: string,
  packageName: string,
  packageDir: string,
): string | null {
  const manifest = readManifest(packageDir);
  const declared = manifest?.types ?? manifest?.typings;
  const own =
    firstExisting(packageDir, [declared, typesFromExports(manifest?.exports), './index.d.ts']) ??
    null;
  if (own !== null) {
    return own;
  }
  const typesDir = join(searchRoot, 'node_modules', typesPackageName(packageName));
  const typesManifest = readManifest(typesDir);
  if (!typesManifest) {
    return null;
  }
  return firstExisting(typesDir, [
    typesManifest.types ?? typesManifest.typings,
    typesFromExports(typesManifest.exports),
    './index.d.ts',
  ]);
}

/** The first candidate that resolves to a readable file under `baseDir`. */
function firstExisting(baseDir: string, candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      continue;
    }
    const absolute = isAbsolute(candidate) ? candidate : resolve(baseDir, candidate);
    try {
      readFileSync(absolute, 'utf8');
      return absolute;
    } catch {
      continue;
    }
  }
  return null;
}
