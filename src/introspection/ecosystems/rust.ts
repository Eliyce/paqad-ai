import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

export const rustParser: EcosystemParser = {
  ecosystem: 'rust',
  packageManager: 'cargo',
  manifestFiles: ['Cargo.toml'],
  lockfileFiles: ['Cargo.lock'],
  parseManifest(content: string): ParsedManifest {
    return {
      ecosystem: 'rust',
      packages: Array.from(content.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"$/gm)).map(
        (match) => ({
          name: match[1] as string,
          constraint: match[2] as string,
          isDev: false,
        }),
      ),
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    return {
      ecosystem: 'rust',
      packages: Array.from(
        content.matchAll(
          /\[\[package\]\][\s\S]*?name\s*=\s*"([^"]+)"[\s\S]*?version\s*=\s*"([^"]+)"/g,
        ),
      ).map((match) => ({
        name: match[1] as string,
        version: match[2] as string,
      })),
    };
  },
};
