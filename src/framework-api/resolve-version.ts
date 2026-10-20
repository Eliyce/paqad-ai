import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

interface PackageManifest {
  version?: string;
  types?: string;
  typings?: string;
  main?: string;
  exports?: unknown;
}

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

export function typesPackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    return `@types/${packageName.slice(1).replace('/', '__')}`;
  }
  return `@types/${packageName}`;
}

export function typesFromExports(exportsField: unknown): string | null {
  if (typeof exportsField === 'string') {
    return exportsField.endsWith('.d.ts') ? exportsField : null;
  }
  if (typeof exportsField !== 'object' || exportsField === null || Array.isArray(exportsField)) {
    return null;
  }
  const entry = exportsField as Record<string, unknown>;
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
