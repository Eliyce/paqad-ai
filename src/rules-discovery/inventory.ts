import { readFileSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';

import YAML from 'yaml';

import { readTextIfExistsSync } from '@/core/fs/read-if-exists.js';
import { DEFAULT_IGNORE_GLOBS, scanWorkingTree } from '@/core/fs/gitignore-scan.js';
import type { StackEcosystem } from '@/core/types/introspection.js';
import { goLocalReplacements } from '@/introspection/ecosystems/go.js';
import { parseYarnLock } from '@/introspection/ecosystems/node-npm.js';
import { createDefaultEcosystemParserRegistry } from '@/introspection/ecosystems/registry.js';
import type { EcosystemParser } from '@/introspection/ecosystems/types.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';

import { baselineLabel, knownVersion, readOrSeedBaseline } from './baseline.js';
import { atomicWriteJson } from './files.js';
import { absRunFile } from './paths.js';
import type {
  BaselinePackage,
  InventoryPackage,
  PackageStatus,
  PrivateReason,
  RulesDiscoveryBaseline,
  StackInventory,
} from './types.js';

export interface BuildInventoryInput {
  projectRoot: string;
  runId: string;
  now?: Date;
  frameworks?: string[];
}

interface ManifestPick {
  manifest: string;
  parser: EcosystemParser;
  lockfile: string | null;
}

interface RawPackage {
  name: string;
  ecosystem: StackEcosystem;
  declared: string | null;
  installed: string | null;
  manifest: string;
  dev: boolean;
  privateReason?: PrivateReason;
}

const PUBLIC_REGISTRY_HOSTS: Partial<Record<StackEcosystem, string[]>> = {
  node: ['registry.npmjs.org', 'registry.yarnpkg.com', 'registry.npmmirror.com'],
  rust: ['github.com/rust-lang/crates.io-index', 'index.crates.io'],
};

export function knownManifestNames(): string[] {
  return Array.from(
    new Set(
      createDefaultEcosystemParserRegistry()
        .list()
        .flatMap((parser) => parser.manifestFiles),
    ),
  ).sort();
}

export function findManifests(projectRoot: string): ManifestPick[] {
  const parsers = createDefaultEcosystemParserRegistry().list();
  const names = knownManifestNames();
  const files = scanWorkingTree(
    projectRoot,
    names.map((name) => `**/${name}`),
    DEFAULT_IGNORE_GLOBS,
  );
  return files.flatMap((manifest): ManifestPick[] => {
    const candidates = parsers.filter((parser) =>
      parser.manifestFiles.some((pattern) => matchesManifestName(basename(manifest), pattern)),
    );
    if (candidates.length === 0) {
      return [];
    }
    for (const dir of ancestorDirs(dirname(manifest))) {
      for (const parser of candidates) {
        const lock = parser.lockfileFiles.find(
          (file) => readTextIfExistsSync(join(projectRoot, dir, file)) !== null,
        );
        if (lock !== undefined) {
          return [{ manifest, parser, lockfile: dir === '.' ? lock : `${dir}/${lock}` }];
        }
      }
    }
    return [{ manifest, parser: candidates[0]!, lockfile: null }];
  });
}

function matchesManifestName(name: string, pattern: string): boolean {
  return pattern.startsWith('*') ? name.endsWith(pattern.slice(1)) : name === pattern;
}

function ancestorDirs(dir: string): string[] {
  const dirs: string[] = [];
  let current = dir === '' ? '.' : dir;
  while (true) {
    dirs.push(current);
    if (current === '.') {
      return dirs;
    }
    const parent = posix.dirname(current);
    current = parent === current ? '.' : parent;
  }
}

function readPackages(projectRoot: string, pick: ManifestPick): RawPackage[] {
  const content = readFileSync(join(projectRoot, pick.manifest), 'utf8');
  const manifest = pick.parser.parseManifest(content, basename(pick.manifest));
  const lockContent =
    pick.lockfile === null ? null : readFileSync(join(projectRoot, pick.lockfile), 'utf8');
  const locked = new Map<string, string>();
  if (lockContent !== null && pick.lockfile !== null) {
    for (const entry of pick.parser.parseLockfile(lockContent, basename(pick.lockfile)).packages) {
      locked.set(entry.name, entry.version);
    }
  }
  const lockSources =
    lockContent === null || pick.lockfile === null
      ? new Map<string, string>()
      : lockfileSources(lockContent, basename(pick.lockfile));
  const replaced =
    pick.parser.ecosystem === 'go' ? new Set(goLocalReplacements(content)) : new Set<string>();
  return manifest.packages.map((pkg) => {
    const declared = knownVersion(pkg.constraint);
    const reason =
      sourceReason(declared) ??
      (replaced.has(pkg.name) ? 'local-path' : undefined) ??
      registryReason(pick.parser.ecosystem, lockSources.get(pkg.name));
    return {
      name: pkg.name,
      ecosystem: pick.parser.ecosystem,
      declared,
      installed: knownVersion(locked.get(pkg.name)),
      manifest: pick.manifest,
      dev: pkg.isDev ?? false,
      ...(reason === undefined ? {} : { privateReason: reason }),
    };
  });
}

function sourceReason(declared: string | null): PrivateReason | undefined {
  if (declared === null) {
    return undefined;
  }
  if (declared.startsWith('workspace:')) {
    return 'workspace-source';
  }
  if (/^(file:|link:|path:|portal:|\.{1,2}\/|\/)/.test(declared)) {
    return 'local-path';
  }
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|https?:\/\/|ssh:\/\/)/.test(declared)) {
    return 'git-source';
  }
  return undefined;
}

function registryReason(
  ecosystem: StackEcosystem,
  resolved: string | undefined,
): PrivateReason | undefined {
  const publicHosts = PUBLIC_REGISTRY_HOSTS[ecosystem];
  if (resolved === undefined || publicHosts === undefined) {
    return undefined;
  }
  if (/^(git\+|git:|github:)/.test(resolved)) {
    return 'git-source';
  }
  if (resolved.startsWith('path+') || resolved.startsWith('file:')) {
    return 'local-path';
  }
  if (!/^(https?:\/\/|registry\+|sparse\+)/.test(resolved)) {
    return undefined;
  }
  return publicHosts.some((host) => resolved.includes(host)) ? undefined : 'private-registry';
}

export function lockfileSources(content: string, filename: string): Map<string, string> {
  const sources = new Map<string, string>();
  if (filename === 'package-lock.json') {
    try {
      const parsed = JSON.parse(content) as { packages?: Record<string, { resolved?: string }> };
      for (const [key, value] of Object.entries(parsed.packages ?? {})) {
        if (key.startsWith('node_modules/') && typeof value.resolved === 'string') {
          sources.set(key.slice('node_modules/'.length), value.resolved);
        }
      }
    } catch {
      return sources;
    }
  } else if (filename === 'yarn.lock') {
    for (const entry of parseYarnLock(content)) {
      if (entry.resolved !== undefined) {
        sources.set(entry.name, entry.resolved);
      }
    }
  } else if (filename === 'pnpm-lock.yaml') {
    try {
      const parsed = YAML.parse(content) as {
        packages?: Record<string, { resolution?: { tarball?: string } }>;
      } | null;
      for (const [key, value] of Object.entries(parsed?.packages ?? {})) {
        const name = /^\/?(@?[^@/]+(?:\/[^@/]+)?)@/.exec(key)?.[1];
        const tarball = value?.resolution?.tarball;
        if (name !== undefined && typeof tarball === 'string') {
          sources.set(name, tarball);
        }
      }
    } catch {
      return sources;
    }
  } else if (filename === 'Cargo.lock') {
    for (const match of content.matchAll(
      /\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"[^[]*?\nsource\s*=\s*"([^"]+)"/g,
    )) {
      sources.set(match[1] as string, match[2] as string);
    }
  } else if (filename === 'composer.lock') {
    try {
      const parsed = JSON.parse(content) as {
        packages?: Array<{ name?: string; dist?: { type?: string } }>;
        'packages-dev'?: Array<{ name?: string; dist?: { type?: string } }>;
      };
      for (const entry of [...(parsed.packages ?? []), ...(parsed['packages-dev'] ?? [])]) {
        if (typeof entry.name === 'string' && entry.dist?.type === 'path') {
          sources.set(entry.name, 'path+local');
        }
      }
    } catch {
      return sources;
    }
  }
  return sources;
}

function workspacePackageNames(projectRoot: string, picks: ManifestPick[]): Set<string> {
  const names = new Set<string>();
  for (const pick of picks) {
    const text = readFileSync(join(projectRoot, pick.manifest), 'utf8');
    const file = basename(pick.manifest);
    if (file === 'package.json' || file === 'composer.json') {
      try {
        const name = (JSON.parse(text) as { name?: unknown }).name;
        if (typeof name === 'string') names.add(name);
      } catch {
        continue;
      }
    } else if (file === 'Cargo.toml') {
      const name = /\[package\][^[]*?\nname\s*=\s*"([^"]+)"/.exec(text)?.[1];
      if (name !== undefined) names.add(name);
    } else if (file === 'pubspec.yaml') {
      const name = /^name:\s*([A-Za-z0-9_]+)/m.exec(text)?.[1];
      if (name !== undefined) names.add(name);
    } else if (file === 'go.mod') {
      const name = /^module\s+(\S+)/m.exec(text)?.[1];
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

const SOURCE_EXTENSIONS: Partial<Record<StackEcosystem, string>> = {
  node: '{ts,tsx,js,jsx,mjs,cjs,vue,svelte}',
  python: 'py',
  go: 'go',
  rust: 'rs',
  ruby: 'rb',
  dart: 'dart',
  dotnet: 'cs',
  jvm: '{java,kt,kts,scala}',
};

function importSpecifiers(ecosystem: StackEcosystem, text: string): string[] {
  const all = (re: RegExp): string[] => Array.from(text.matchAll(re), (m) => m[1] ?? '');
  switch (ecosystem) {
    case 'node':
      return [
        ...all(/\bfrom\s+['"]([^'"]+)['"]/g),
        ...all(/\bimport\s+['"]([^'"]+)['"]/g),
        ...all(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ];
    case 'python':
      return [
        ...all(/^\s*import\s+([A-Za-z0-9_.]+)/gm),
        ...all(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\b/gm),
      ];
    case 'go':
      return all(/^\s*(?:import\s+)?(?:[A-Za-z_.]+\s+)?"([^"\s]+)"\s*$/gm);
    case 'rust':
      return all(/^\s*(?:pub\s+)?(?:use|extern\s+crate)\s+([A-Za-z0-9_]+)/gm);
    case 'ruby':
      return all(/^\s*require\s+['"]([^'"]+)['"]/gm);
    case 'dart':
      return all(/['"]package:([A-Za-z0-9_]+)\//g);
    case 'dotnet':
      return all(/^\s*using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm);
    case 'jvm':
      return all(/^\s*import\s+(?:static\s+)?([A-Za-z0-9_.]+)/gm);
    default:
      return [];
  }
}

function importMatches(ecosystem: StackEcosystem, name: string, spec: string): boolean {
  switch (ecosystem) {
    case 'node':
      return spec === name || spec.startsWith(`${name}/`);
    case 'python': {
      const top = spec.split('.')[0]?.toLowerCase() ?? '';
      return top === name.toLowerCase().replace(/-/g, '_');
    }
    case 'go':
      return spec === name || spec.startsWith(`${name}/`);
    case 'rust':
      return spec === name.replace(/-/g, '_');
    case 'ruby':
      return spec === name || spec.startsWith(`${name}/`);
    case 'dart':
      return spec === name;
    case 'dotnet':
      return spec === name || spec.startsWith(`${name}.`);
    case 'jvm': {
      const group = name.split(':')[0] ?? '';
      return group !== '' && (spec === group || spec.startsWith(`${group}.`));
    }
    default:
      return false;
  }
}

export function countImports(
  projectRoot: string,
  packages: Array<{ name: string; ecosystem: StackEcosystem }>,
): Map<string, number | null> {
  const counts = new Map<string, number | null>();
  const ecosystems = new Set(packages.map((pkg) => pkg.ecosystem));
  for (const ecosystem of ecosystems) {
    const extension = SOURCE_EXTENSIONS[ecosystem];
    const own = packages.filter((pkg) => pkg.ecosystem === ecosystem);
    if (extension === undefined) {
      for (const pkg of own) counts.set(packageKey(pkg), null);
      continue;
    }
    for (const pkg of own) counts.set(packageKey(pkg), 0);
    const files = scanWorkingTree(projectRoot, [`**/*.${extension}`], DEFAULT_IGNORE_GLOBS);
    for (const file of files) {
      const text = readTextIfExistsSync(join(projectRoot, file));
      if (text === null) continue;
      const specs = importSpecifiers(ecosystem, text);
      if (specs.length === 0) continue;
      for (const pkg of own) {
        if (specs.some((spec) => importMatches(ecosystem, pkg.name, spec))) {
          const key = packageKey(pkg);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

export function packageKey(pkg: { name: string; ecosystem: string }): string {
  return `${pkg.ecosystem}:${pkg.name}`;
}

function statusAgainst(
  pkg: RawPackage,
  baseline: Map<string, BaselinePackage> | null,
): PackageStatus {
  if (baseline === null) {
    return 'unchanged';
  }
  const before = baseline.get(packageKey(pkg));
  if (before === undefined) {
    return 'new';
  }
  const changed =
    (pkg.installed !== null && before.installed !== null && pkg.installed !== before.installed) ||
    (pkg.declared !== null && before.declared !== null && pkg.declared !== before.declared);
  return changed ? 'version-changed' : 'unchanged';
}

async function detectFrameworks(projectRoot: string): Promise<string[]> {
  const snapshot = await new StackIntrospector().snapshot(projectRoot, { persist: false });
  return [...snapshot.profile.frameworks].sort();
}

export async function buildStackInventory(input: BuildInventoryInput): Promise<StackInventory> {
  const now = input.now ?? new Date();
  const picks = findManifests(input.projectRoot);
  const raw = picks.flatMap((pick) => readPackages(input.projectRoot, pick));
  const workspaceNames = workspacePackageNames(input.projectRoot, picks);
  const baseline = readOrSeedBaseline(input.projectRoot, now);
  const baselineMap = baseline === null ? null : baselineIndex(baseline);
  const counts = countImports(input.projectRoot, raw);
  const current: InventoryPackage[] = raw.map((pkg) => {
    const reason: PrivateReason | undefined =
      pkg.privateReason ?? (workspaceNames.has(pkg.name) ? 'workspace-package' : undefined);
    const importCount = counts.get(packageKey(pkg)) ?? null;
    return {
      name: pkg.name,
      ecosystem: pkg.ecosystem,
      declared: pkg.declared,
      installed: pkg.installed,
      manifest: pkg.manifest,
      dev: pkg.dev,
      import_count: importCount,
      unused: importCount === 0,
      status: statusAgainst(pkg, baselineMap),
      private: reason !== undefined,
      ...(reason === undefined ? {} : { private_reason: reason }),
    };
  });
  const present = new Set(current.map(packageKey));
  const removed: InventoryPackage[] =
    baseline === null
      ? []
      : baseline.packages
          .filter((pkg) => !present.has(packageKey(pkg)))
          .map((pkg) => ({
            name: pkg.name,
            ecosystem: pkg.ecosystem as StackEcosystem,
            declared: pkg.declared,
            installed: pkg.installed,
            manifest: '',
            dev: pkg.dev,
            import_count: null,
            unused: false,
            status: 'removed',
            private: false,
          }));
  const inventory: StackInventory = {
    schema_version: 1,
    generated_at: now.toISOString(),
    run_id: input.runId,
    packages: [...current, ...removed].sort(
      (left, right) =>
        left.ecosystem.localeCompare(right.ecosystem) ||
        left.name.localeCompare(right.name) ||
        left.manifest.localeCompare(right.manifest),
    ),
    frameworks: input.frameworks ?? (await detectFrameworks(input.projectRoot)),
    manifests: picks.map((pick) => pick.manifest),
    manifests_looked_for: picks.length === 0 ? knownManifestNames() : [],
    compared_to: baseline === null ? null : baselineLabel(baseline),
  };
  return inventory;
}

function baselineIndex(baseline: RulesDiscoveryBaseline): Map<string, BaselinePackage> {
  return new Map(baseline.packages.map((pkg) => [packageKey(pkg), pkg]));
}

export async function writeStackInventory(input: BuildInventoryInput): Promise<StackInventory> {
  const inventory = await buildStackInventory(input);
  atomicWriteJson(absRunFile(input.projectRoot, input.runId, 'inventory'), inventory);
  return inventory;
}

export function inventorySummary(inventory: StackInventory): string {
  if (inventory.manifests.length === 0) {
    return `no package manifest found — looked for ${inventory.manifests_looked_for.join(', ')}. Rules discovery goes on with decisions and existing rules only.`;
  }
  const count = (status: PackageStatus): number =>
    inventory.packages.filter((pkg) => pkg.status === status).length;
  const listed = inventory.packages.filter((pkg) => pkg.status !== 'removed').length;
  return `${listed} packages from ${inventory.manifests.length} manifest${inventory.manifests.length === 1 ? '' : 's'}: ${count('new')} new, ${count('version-changed')} version-changed, ${count('removed')} removed${inventory.compared_to === null ? ' (first run, no baseline)' : ` against ${inventory.compared_to}`}.`;
}
