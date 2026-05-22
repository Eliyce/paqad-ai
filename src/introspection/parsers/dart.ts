import YAML from 'yaml';

import type { InstalledPackage, ToolchainInfo } from '@/core/types/introspection.js';

import { readTextFile } from './shared.js';

interface PubspecLike {
  dependencies?: Record<string, string | { sdk?: string }>;
  dev_dependencies?: Record<string, string | { sdk?: string }>;
}

interface PubspecLockLike {
  packages?: Record<string, { version?: string }>;
}

export async function parseDartProject(
  projectRoot: string,
): Promise<{ toolchain: ToolchainInfo; packages: InstalledPackage[] } | null> {
  const pubspecText = await readTextFile(projectRoot, 'pubspec.yaml');
  if (pubspecText === null) {
    return null;
  }

  const pubspec = YAML.parse(pubspecText) as PubspecLike;
  const pubspecLockText = await readTextFile(projectRoot, 'pubspec.lock');
  const pubspecLock = pubspecLockText ? (YAML.parse(pubspecLockText) as PubspecLockLike) : null;
  const lockedVersions = new Map<string, string>();

  for (const [name, value] of Object.entries(pubspecLock?.packages ?? {})) {
    if (value.version) {
      lockedVersions.set(name, value.version);
    }
  }

  return {
    toolchain: {
      ecosystem: 'dart',
      package_manager: 'pub',
      lockfile: 'pubspec.lock',
    },
    packages: [
      ...buildPackages(pubspec.dependencies ?? {}, lockedVersions, false),
      ...buildPackages(pubspec.dev_dependencies ?? {}, lockedVersions, true),
    ].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function buildPackages(
  dependencies: Record<string, string | { sdk?: string }>,
  lockedVersions: Map<string, string>,
  is_dev: boolean,
): InstalledPackage[] {
  return Object.entries(dependencies).map(([name, value]) => {
    const version_constraint =
      typeof value === 'string' ? value : value.sdk !== undefined ? `sdk:${value.sdk}` : 'unknown';

    return {
      name,
      version_constraint,
      locked_version: lockedVersions.get(name) ?? version_constraint,
      ecosystem: 'dart' as const,
      is_dev,
    };
  });
}
