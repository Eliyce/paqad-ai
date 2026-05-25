import YAML from 'yaml';

import { readJson } from './shared.js';
import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface PnpmLockLike {
  packages?: Record<string, { version?: string }>;
}

export const pnpmParser: EcosystemParser = {
  ecosystem: 'node',
  packageManager: 'pnpm',
  manifestFiles: ['package.json'],
  lockfileFiles: ['pnpm-lock.yaml'],
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
    let parsed: PnpmLockLike | null;
    try {
      parsed = YAML.parse(content) as PnpmLockLike;
    } catch {
      parsed = null;
    }

    return {
      ecosystem: 'node',
      packages: Object.entries(parsed?.packages ?? {})
        .map(([key, value]) => {
          const match = key.match(/^\/?(@?[^@/]+(?:\/[^@/]+)?)@/);
          if (!match?.[1] || value.version === undefined) {
            return null;
          }

          return {
            name: match[1],
            version: value.version,
          };
        })
        .filter((entry): entry is { name: string; version: string } => entry !== null)
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
};
