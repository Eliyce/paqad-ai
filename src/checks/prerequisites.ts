import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PackageEcosystem = 'composer' | 'python' | 'node' | 'ruby';

const ECOSYSTEM_FILES: Record<PackageEcosystem, string[]> = {
  composer: ['composer.lock'],
  python: ['poetry.lock', 'uv.lock', 'Pipfile.lock', 'pyproject.toml'],
  node: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock'],
  ruby: ['Gemfile.lock'],
};

const PYTHON_REQUIREMENTS = /^requirements.*\.txt$/i;

function normalize(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    /* v8 ignore next -- unreadable-but-present lockfile degrades to "not found here", never throws */
    return null;
  }
}

function composerHas(content: string, name: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  const target = normalize(name);
  const buckets = ['packages', 'packages-dev'] as const;
  for (const bucket of buckets) {
    const list = (parsed as Record<string, unknown>)?.[bucket];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const entryName = (entry as Record<string, unknown>)?.name;
      if (typeof entryName === 'string' && normalize(entryName) === target) return true;
    }
  }
  return false;
}

export function hasPackage(
  projectRoot: string,
  ecosystem: PackageEcosystem,
  name: string,
): boolean | null {
  const candidates = ECOSYSTEM_FILES[ecosystem].map((file) => join(projectRoot, file));

  if (ecosystem === 'python') {
    try {
      for (const entry of readdirSync(projectRoot)) {
        if (PYTHON_REQUIREMENTS.test(entry)) candidates.push(join(projectRoot, entry));
      }
    } catch {
      /* v8 ignore next -- an unreadable project root just means no extra requirements files */
    }
  }

  const present = candidates.map((path) => ({ path, content: readIfPresent(path) }));
  const found = present.filter((entry) => entry.content !== null);
  if (found.length === 0) return null;

  const target = normalize(name);
  for (const entry of found) {
    if (ecosystem === 'composer') {
      if (composerHas(entry.content!, name)) return true;
    } else if (normalize(entry.content!).includes(target)) {
      return true;
    }
  }
  return false;
}

export type NodePackageManager = 'pnpm' | 'yarn' | 'npm';

const NODE_LOCKFILE_MANAGERS: ReadonlyArray<readonly [string, NodePackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

export function nodePackageManager(projectRoot: string): NodePackageManager {
  const found = NODE_LOCKFILE_MANAGERS.find(([lockfile]) =>
    existsSync(join(projectRoot, lockfile)),
  );
  return found?.[1] ?? 'npm';
}
