import { readJson } from './shared.js';
import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

interface PackagesLockLike {
  dependencies?: Record<string, Record<string, { type?: string; resolved?: string }>>;
}

export const dotnetParser: EcosystemParser = {
  ecosystem: 'dotnet',
  packageManager: 'nuget',
  manifestFiles: ['*.csproj'],
  lockfileFiles: ['packages.lock.json'],
  parseManifest(content: string): ParsedManifest {
    return {
      ecosystem: 'dotnet',
      packages: Array.from(
        content.matchAll(/<PackageReference\b([^>]*?)(\/>|>([\s\S]*?)<\/PackageReference>)/g),
      )
        .map((match) => {
          const attributes = match[1] ?? '';
          const name = /\bInclude\s*=\s*"([^"]+)"/.exec(attributes)?.[1];
          if (!name) {
            return null;
          }
          const version =
            /\bVersion\s*=\s*"([^"]+)"/.exec(attributes)?.[1] ??
            /<Version>([^<]+)<\/Version>/.exec(match[3] ?? '')?.[1];
          const privateAssets =
            /\bPrivateAssets\s*=\s*"all"/i.test(attributes) ||
            /<PrivateAssets>\s*all\s*<\/PrivateAssets>/i.test(match[3] ?? '');
          return { name, constraint: version, isDev: privateAssets };
        })
        .filter(
          (entry): entry is { name: string; constraint: string | undefined; isDev: boolean } =>
            entry !== null,
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    const parsed = readJson<PackagesLockLike>(content);
    const seen = new Map<string, string>();
    for (const framework of Object.values(parsed?.dependencies ?? {})) {
      for (const [name, entry] of Object.entries(framework)) {
        if (entry.type === 'Direct' && typeof entry.resolved === 'string' && !seen.has(name)) {
          seen.set(name, entry.resolved);
        }
      }
    }
    return {
      ecosystem: 'dotnet',
      packages: [...seen.entries()]
        .map(([name, version]) => ({ name, version }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
};
