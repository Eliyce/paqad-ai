import type { InstalledPackage, ToolchainInfo } from '@/core/types/introspection.js';

import { readJsonFile } from './shared.js';

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLockLike {
  packages?: Record<string, { version?: string }>;
}

export async function parseNpmProject(
  projectRoot: string,
): Promise<{ toolchain: ToolchainInfo; packages: InstalledPackage[] } | null> {
  const packageJson = await readJsonFile<PackageJsonLike>(projectRoot, 'package.json');
  const packageLock = await readJsonFile<PackageLockLike>(projectRoot, 'package-lock.json');

  if (packageJson === null) {
    return null;
  }

  const lockedVersions = new Map<string, string>();

  for (const [key, value] of Object.entries(packageLock?.packages ?? {})) {
    if (!key.startsWith('node_modules/') || value.version === undefined) {
      continue;
    }

    lockedVersions.set(key.replace(/^node_modules\//, ''), value.version);
  }

  return {
    toolchain: {
      ecosystem: 'node',
      package_manager: 'npm',
      lockfile: 'package-lock.json',
    },
    packages: buildNodePackages(packageJson, lockedVersions),
  };
}

function buildNodePackages(
  packageJson: PackageJsonLike,
  lockedVersions: Map<string, string>,
): InstalledPackage[] {
  const runtime = Object.entries(packageJson.dependencies ?? {}).map(
    ([name, version_constraint]) => ({
      name,
      version_constraint,
      locked_version: lockedVersions.get(name) ?? version_constraint,
      ecosystem: 'node' as const,
      is_dev: false,
    }),
  );
  const dev = Object.entries(packageJson.devDependencies ?? {}).map(
    ([name, version_constraint]) => ({
      name,
      version_constraint,
      locked_version: lockedVersions.get(name) ?? version_constraint,
      ecosystem: 'node' as const,
      is_dev: true,
    }),
  );

  return [...runtime, ...dev].sort((left, right) => left.name.localeCompare(right.name));
}
