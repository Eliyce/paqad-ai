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
  lockfileFiles: ['package-lock.json', 'yarn.lock'],
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
  parseLockfile(content: string, filename: string): ParsedLockfile {
    if (filename === 'yarn.lock') {
      return { ecosystem: 'node', packages: parseYarnLock(content) };
    }
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

export function parseYarnLock(
  content: string,
): Array<{ name: string; version: string; resolved?: string }> {
  const entries = new Map<string, { name: string; version: string; resolved?: string }>();
  for (const block of content.split(/\n(?=\S)/)) {
    const header = block.split('\n')[0]?.trim() ?? '';
    if (header === '' || header.startsWith('#') || header.startsWith('__metadata')) {
      continue;
    }
    const first = header.replace(/:$/, '').split(',')[0]?.trim().replace(/^"|"$/g, '') ?? '';
    const at = first.indexOf('@', first.startsWith('@') ? 1 : 0);
    const name = at > 0 ? first.slice(0, at) : first;
    const version = /^\s+version:?\s+"?([^"\s]+)"?/m.exec(block)?.[1];
    const resolved = /^\s+(?:resolved|resolution):?\s+"?([^"\s]+)"?/m.exec(block)?.[1];
    if (name !== '' && version !== undefined && !entries.has(name)) {
      entries.set(name, resolved === undefined ? { name, version } : { name, version, resolved });
    }
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}
