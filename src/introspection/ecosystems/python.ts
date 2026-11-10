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

  if (trimmed === 'pyproject.toml') {
    return { ecosystem: 'python', packages: parsePyproject(content) };
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

    const tomlPackages = Array.from(
      content.matchAll(/\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g),
    ).map((match) => ({ name: match[1] as string, version: match[2] as string }));
    if (tomlPackages.length > 0) {
      return { ecosystem: 'python', packages: tomlPackages };
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

function parsePyproject(
  content: string,
): Array<{ name: string; constraint?: string; isDev: boolean }> {
  const packages = new Map<string, { name: string; constraint?: string; isDev: boolean }>();
  const add = (name: string, constraint: string | undefined, isDev: boolean): void => {
    if (name === '' || name.toLowerCase() === 'python' || packages.has(name)) {
      return;
    }
    packages.set(name, constraint === undefined ? { name, isDev } : { name, constraint, isDev });
  };
  const requirement = (spec: string, isDev: boolean): void => {
    const match = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(.*)$/.exec(spec);
    if (match?.[1]) {
      add(match[1], match[2]?.trim() || undefined, isDev);
    }
  };
  let section = '';
  let arrayFor: 'deps' | 'dev' | null = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (arrayFor !== null) {
      for (const quoted of line.matchAll(/["']([^"']+)["']/g)) {
        requirement(quoted[1] ?? '', arrayFor === 'dev');
      }
      if (line.includes(']')) {
        arrayFor = null;
      }
      continue;
    }
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]?.trim() ?? '';
      continue;
    }
    const isDevTable = /^tool\.poetry\.(dev-dependencies|group\.[^.]+\.dependencies)$/.test(
      section,
    );
    if (section === 'tool.poetry.dependencies' || isDevTable) {
      const entry = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
      if (entry?.[1]) {
        const plain = /^"([^"]*)"$/.exec(entry[2]?.trim() ?? '');
        const table = /\bversion\s*=\s*"([^"]+)"/.exec(entry[2] ?? '');
        const path = /\bpath\s*=\s*"([^"]+)"/.exec(entry[2] ?? '');
        const git = /\bgit\s*=\s*"([^"]+)"/.exec(entry[2] ?? '');
        add(
          entry[1],
          plain?.[1] ??
            table?.[1] ??
            (path ? `path:${path[1]}` : git ? `git:${git[1]}` : undefined),
          isDevTable,
        );
      }
      continue;
    }
    const isProjectDeps = section === 'project' && /^dependencies\s*=\s*\[/.test(line);
    const isDevGroup =
      (section === 'project.optional-dependencies' || section === 'dependency-groups') &&
      /^(dev|test|tests|lint)\s*=\s*\[/.test(line);
    if (isProjectDeps || isDevGroup) {
      const body = line.slice(line.indexOf('[') + 1);
      for (const quoted of body.matchAll(/["']([^"']+)["']/g)) {
        requirement(quoted[1] ?? '', isDevGroup);
      }
      if (!body.includes(']')) {
        arrayFor = isDevGroup ? 'dev' : 'deps';
      }
    }
  }
  return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
}
