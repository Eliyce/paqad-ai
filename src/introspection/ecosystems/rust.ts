import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

export const rustParser: EcosystemParser = {
  ecosystem: 'rust',
  packageManager: 'cargo',
  manifestFiles: ['Cargo.toml'],
  lockfileFiles: ['Cargo.lock'],
  parseManifest(content: string): ParsedManifest {
    return {
      ecosystem: 'rust',
      packages: parseCargoDependencies(content),
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

function parseCargoDependencies(
  content: string,
): Array<{ name: string; constraint: string; isDev: boolean }> {
  const packages: Array<{ name: string; constraint: string; isDev: boolean }> = [];
  let section: 'deps' | 'dev' | null = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = header[1]?.trim() ?? '';
      section = /(^|\.)dependencies$/.test(name)
        ? name.endsWith('dev-dependencies')
          ? 'dev'
          : name.endsWith('build-dependencies')
            ? null
            : 'deps'
        : null;
      continue;
    }
    if (section === null) {
      continue;
    }
    const entry = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!entry?.[1] || !entry[2]) {
      continue;
    }
    packages.push({
      name: entry[1],
      constraint: cargoConstraint(entry[2]),
      isDev: section === 'dev',
    });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

function cargoConstraint(value: string): string {
  const plain = /^"([^"]*)"$/.exec(value.trim());
  if (plain) {
    return plain[1] ?? 'unknown';
  }
  const path = /\bpath\s*=\s*"([^"]+)"/.exec(value)?.[1];
  if (path !== undefined) {
    return `path:${path}`;
  }
  const git = /\bgit\s*=\s*"([^"]+)"/.exec(value)?.[1];
  if (git !== undefined) {
    return `git:${git}`;
  }
  return /\bversion\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? 'unknown';
}
