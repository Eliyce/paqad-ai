import { parseKeyValueLines } from './shared.js';
import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

function parsePythonManifest(content: string, filename: string): ParsedManifest {
  const trimmed = filename.toLowerCase();

  if (trimmed === 'requirements.txt') {
    return {
      ecosystem: 'python',
      packages: parseKeyValueLines(content, '==').map(({ name, value }) => ({
        name,
        constraint: value,
        isDev: false,
      })),
    };
  }

  const matches = Array.from(
    content.matchAll(/^[ \t]*["']?([A-Za-z0-9_.-]+)["']?\s*(?:[<>=!~]=?.+)?/gm),
  );
  return {
    ecosystem: 'python',
    packages: matches
      .map((match) => match[1]?.trim())
      .filter((name): name is string => Boolean(name) && !name.startsWith('['))
      .map((name) => ({ name, isDev: false })),
  };
}

export const pythonParser: EcosystemParser = {
  ecosystem: 'python',
  packageManager: 'pip',
  manifestFiles: ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'],
  lockfileFiles: ['Pipfile.lock', 'poetry.lock', 'uv.lock'],
  parseManifest(content: string, filename: string): ParsedManifest {
    return parsePythonManifest(content, filename);
  },
  parseLockfile(content: string, filename: string): ParsedLockfile {
    if (filename === 'Pipfile.lock') {
      try {
        const parsed = JSON.parse(content) as {
          default?: Record<string, { version?: string }>;
          develop?: Record<string, { version?: string }>;
        };
        return {
          ecosystem: 'python',
          packages: [
            ...Object.entries(parsed.default ?? {}),
            ...Object.entries(parsed.develop ?? {}),
          ]
            .filter(([, value]) => typeof value.version === 'string')
            .map(([name, value]) => ({ name, version: value.version as string })),
        };
      } catch {
        return { ecosystem: 'python', packages: [] };
      }
    }

    return {
      ecosystem: 'python',
      packages: parseKeyValueLines(content, '==').map(({ name, value }) => ({
        name,
        version: value,
      })),
    };
  },
};
