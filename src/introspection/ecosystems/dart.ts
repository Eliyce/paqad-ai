import YAML from 'yaml';

import { normalizeConstraint } from './shared.js';
import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

interface PubspecLike {
  dependencies?: Record<string, unknown>;
  dev_dependencies?: Record<string, unknown>;
}

interface PubspecLockLike {
  packages?: Record<string, { version?: string }>;
}

export const dartParser: EcosystemParser = {
  ecosystem: 'dart',
  packageManager: 'pub',
  manifestFiles: ['pubspec.yaml'],
  lockfileFiles: ['pubspec.lock'],
  parseManifest(content: string): ParsedManifest {
    let parsed: PubspecLike | null = null;
    try {
      parsed = YAML.parse(content) as PubspecLike;
    } catch {
      parsed = null;
    }

    return {
      ecosystem: 'dart',
      packages: [
        ...Object.entries(parsed?.dependencies ?? {}).map(([name, value]) => ({
          name,
          constraint: normalizeConstraint(value),
          isDev: false,
        })),
        ...Object.entries(parsed?.dev_dependencies ?? {}).map(([name, value]) => ({
          name,
          constraint: normalizeConstraint(value),
          isDev: true,
        })),
      ].sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    let parsed: PubspecLockLike | null = null;
    try {
      parsed = YAML.parse(content) as PubspecLockLike;
    } catch {
      parsed = null;
    }

    return {
      ecosystem: 'dart',
      packages: Object.entries(parsed?.packages ?? {})
        .filter(([, value]) => typeof value.version === 'string')
        .map(([name, value]) => ({ name, version: value.version as string }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
};
