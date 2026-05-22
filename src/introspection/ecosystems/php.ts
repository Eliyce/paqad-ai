import { readJson } from './shared.js';
import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

interface ComposerJsonLike {
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
}

interface ComposerLockLike {
  packages?: Array<{ name: string; version: string }>;
  'packages-dev'?: Array<{ name: string; version: string }>;
}

export const phpParser: EcosystemParser = {
  ecosystem: 'php',
  packageManager: 'composer',
  manifestFiles: ['composer.json'],
  lockfileFiles: ['composer.lock'],
  parseManifest(content: string): ParsedManifest {
    const parsed = readJson<ComposerJsonLike>(content);

    return {
      ecosystem: 'php',
      packages: [
        ...Object.entries(parsed?.require ?? {}).map(([name, constraint]) => ({
          name,
          constraint,
          isDev: false,
        })),
        ...Object.entries(parsed?.['require-dev'] ?? {}).map(([name, constraint]) => ({
          name,
          constraint,
          isDev: true,
        })),
      ].sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    const parsed = readJson<ComposerLockLike>(content);

    return {
      ecosystem: 'php',
      packages: [...(parsed?.packages ?? []), ...(parsed?.['packages-dev'] ?? [])]
        .map((pkg) => ({ name: pkg.name, version: pkg.version }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
};
