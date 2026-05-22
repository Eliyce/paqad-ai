import { readJson } from './shared.js';
import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface PackageLockLike {
  packages?: Record<string, { version?: string }>;
}

export const npmParser: EcosystemParser = {
  ecosystem: 'node',
  packageManager: 'npm',
  manifestFiles: ['package.json'],
  lockfileFiles: ['package-lock.json'],
  parseManifest(content: string): ParsedManifest {
    const parsed = readJson<PackageJsonLike>(content);

    return {
      ecosystem: 'node',
      packages: [
        ...Object.entries(parsed?.dependencies ?? {}).map(([name, constraint]) => ({
          name,
          constraint,
          isDev: false,
        })),
        ...Object.entries(parsed?.devDependencies ?? {}).map(([name, constraint]) => ({
          name,
          constraint,
          isDev: true,
        })),
      ].sort((left, right) => left.name.localeCompare(right.name)),
      scripts: parsed?.scripts ?? {},
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    const parsed = readJson<PackageLockLike>(content);

    return {
      ecosystem: 'node',
      packages: Object.entries(parsed?.packages ?? {})
        .filter(([key, value]) => key.startsWith('node_modules/') && value.version !== undefined)
        .map(([key, value]) => ({
          name: key.replace(/^node_modules\//, ''),
          version: value.version as string,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
};
