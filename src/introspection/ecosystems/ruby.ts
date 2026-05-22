import { parseKeyValueLines } from './shared.js';
import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

export const rubyParser: EcosystemParser = {
  ecosystem: 'ruby',
  packageManager: 'bundler',
  manifestFiles: ['Gemfile'],
  lockfileFiles: ['Gemfile.lock'],
  parseManifest(content: string): ParsedManifest {
    return {
      ecosystem: 'ruby',
      packages: Array.from(
        content.matchAll(/gem\s+["']([^"']+)["'](?:,\s*["']([^"']+)["'])?/g),
      ).map((match) => ({
        name: match[1] as string,
        constraint: match[2],
        isDev: false,
      })),
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    return {
      ecosystem: 'ruby',
      packages: parseKeyValueLines(
        content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith(' ') === false && /\(.+\)/.test(line))
          .join('\n'),
        ' (',
      ).map(({ name, value }) => ({
        name,
        version: value.replace(/\)$/, ''),
      })),
    };
  },
};
