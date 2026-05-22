import YAML from 'yaml';

import type { InstalledPackage, ToolchainInfo } from '@/core/types/introspection.js';

import { readJsonFile, readTextFile } from './shared.js';

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function parsePnpmProject(
  projectRoot: string,
): Promise<{ toolchain: ToolchainInfo; packages: InstalledPackage[] } | null> {
  const packageJson = await readJsonFile<PackageJsonLike>(projectRoot, 'package.json');
  const lockfile = await readTextFile(projectRoot, 'pnpm-lock.yaml');

  if (packageJson === null) {
    return null;
  }

  const parsedLock = lockfile
    ? (YAML.parse(lockfile) as { packages?: Record<string, { version?: string }> })
    : null;
  const lockedVersions = new Map<string, string>();

  for (const [key, value] of Object.entries(parsedLock?.packages ?? {})) {
    const match = key.match(/^\/?(@?[^@/]+(?:\/[^@/]+)?)@/);
    if (match?.[1] && value.version) {
      lockedVersions.set(match[1], value.version);
    }
  }

  return {
    toolchain: {
      ecosystem: 'node',
      package_manager: 'pnpm',
      lockfile: 'pnpm-lock.yaml',
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
