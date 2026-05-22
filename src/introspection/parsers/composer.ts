import type { InstalledPackage, ToolchainInfo } from '@/core/types/introspection.js';

import { readJsonFile } from './shared.js';

interface ComposerJsonLike {
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
}

interface ComposerLockLike {
  packages?: Array<{ name: string; version: string }>;
  'packages-dev'?: Array<{ name: string; version: string }>;
}

export async function parseComposerProject(
  projectRoot: string,
): Promise<{ toolchain: ToolchainInfo; packages: InstalledPackage[] } | null> {
  const composerJson = await readJsonFile<ComposerJsonLike>(projectRoot, 'composer.json');
  const composerLock = await readJsonFile<ComposerLockLike>(projectRoot, 'composer.lock');

  if (composerJson === null) {
    return null;
  }

  const lockedVersions = new Map<string, string>();
  for (const pkg of composerLock?.packages ?? []) {
    lockedVersions.set(pkg.name, pkg.version);
  }
  for (const pkg of composerLock?.['packages-dev'] ?? []) {
    lockedVersions.set(pkg.name, pkg.version);
  }

  return {
    toolchain: {
      ecosystem: 'php',
      package_manager: 'composer',
      lockfile: 'composer.lock',
    },
    packages: [
      ...Object.entries(composerJson.require ?? {}).map(([name, version_constraint]) => ({
        name,
        version_constraint,
        locked_version: lockedVersions.get(name) ?? version_constraint,
        ecosystem: 'php' as const,
        is_dev: false,
      })),
      ...Object.entries(composerJson['require-dev'] ?? {}).map(([name, version_constraint]) => ({
        name,
        version_constraint,
        locked_version: lockedVersions.get(name) ?? version_constraint,
        ecosystem: 'php' as const,
        is_dev: true,
      })),
    ].sort((left, right) => left.name.localeCompare(right.name)),
  };
}
