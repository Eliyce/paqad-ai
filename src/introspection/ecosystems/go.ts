import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

export const goParser: EcosystemParser = {
  ecosystem: 'go',
  packageManager: 'go',
  manifestFiles: ['go.mod'],
  lockfileFiles: ['go.sum'],
  parseManifest(content: string): ParsedManifest {
    return {
      ecosystem: 'go',
      packages: Array.from(content.matchAll(/^\s*require\s+([^\s]+)\s+([^\s]+)$/gm)).map(
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
      ecosystem: 'go',
      packages: content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => {
          const [name, version] = line.split(/\s+/, 3);
          if (!name || !version) {
            return null;
          }
          return { name, version };
        })
        .filter((entry): entry is { name: string; version: string } => entry !== null),
    };
  },
};
