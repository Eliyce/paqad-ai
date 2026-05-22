import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';

import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { LoadedStackPack, PackInstallSource } from '@/core/types/pack.js';

import { StackPackLoader } from './loader.js';

export interface PackManagerRoots {
  runtimeRoot: string;
  globalPacksRoot: string;
  projectPacksRoot: string;
  registryUrl?: string;
}

export interface ListedPack {
  name: string;
  effective_source: PackInstallSource;
  available_sources: PackInstallSource[];
  override_active: boolean;
  matched_in_project: boolean;
  display_name: string;
  tier: 'framework' | 'archetype';
}

export interface InstallPackOptions {
  projectRoot?: string;
  scope?: 'global' | 'project';
  roots?: Partial<PackManagerRoots>;
}

export interface CreatePackOptions {
  destinationRoot?: string;
  ecosystem?: string;
  tier?: 'framework' | 'archetype';
}

const SOURCE_ORDER: PackInstallSource[] = ['built-in', 'global', 'project'];

export function resolvePackManagerRoots(
  projectRoot: string = process.cwd(),
  overrides: Partial<PackManagerRoots> = {},
): PackManagerRoots {
  return {
    runtimeRoot: overrides.runtimeRoot ?? getRuntimeRoot(),
    globalPacksRoot:
      overrides.globalPacksRoot ??
      process.env.PAQAD_GLOBAL_PACKS_ROOT ??
      join(homedir(), '.paqad', 'packs'),
    projectPacksRoot: overrides.projectPacksRoot ?? join(projectRoot, '.paqad', 'packs'),
    registryUrl: overrides.registryUrl ?? process.env.PAQAD_PACK_REGISTRY_URL,
  };
}

export function listPacks(
  projectRoot: string = process.cwd(),
  overrides: Partial<PackManagerRoots> = {},
): ListedPack[] {
  const roots = resolvePackManagerRoots(projectRoot, overrides);
  const registry = new StackPackLoader().load({
    runtimeRoot: roots.runtimeRoot,
    globalPacksRoot: roots.globalPacksRoot,
    projectRoot,
  });
  const availableByName = new Map<string, Set<PackInstallSource>>();

  for (const source of SOURCE_ORDER) {
    for (const name of listPackNamesForSource(source, roots)) {
      const sources = availableByName.get(name) ?? new Set<PackInstallSource>();
      sources.add(source);
      availableByName.set(name, sources);
    }
  }

  const matchedFrameworks = new Set(
    readProjectProfile(projectRoot)?.stack_profile?.frameworks ?? [],
  );

  return [...registry.packs.values()]
    .map((pack) => {
      const availableSources = [
        ...(availableByName.get(pack.manifest.name) ?? new Set([pack.source])),
      ].sort(compareSources);
      return {
        name: pack.manifest.name,
        effective_source: pack.source,
        available_sources: availableSources,
        override_active: availableSources.length > 1,
        matched_in_project: matchedFrameworks.has(pack.manifest.name),
        display_name: pack.manifest.display_name,
        tier: pack.manifest.tier ?? 'framework',
      } satisfies ListedPack;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function installPack(
  source: string,
  options: InstallPackOptions = {},
): Promise<LoadedStackPack> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const roots = resolvePackManagerRoots(projectRoot, options.roots);
  const scope = options.scope ?? 'global';
  const installRoot = scope === 'project' ? roots.projectPacksRoot : roots.globalPacksRoot;
  mkdirSync(installRoot, { recursive: true });

  const candidateRoot = await materializePackSource(source, roots);
  const loader = new StackPackLoader();
  const pack = loader.validatePack(candidateRoot, scope === 'project' ? 'project' : 'global');

  if (!pack.validation.valid) {
    throw new Error(formatValidationIssues(pack.validation.issues));
  }

  const destination = join(installRoot, pack.manifest.name);
  rmSync(destination, { recursive: true, force: true });
  cpSync(candidateRoot, destination, { recursive: true });

  const installed = loader.validatePack(destination, scope === 'project' ? 'project' : 'global');
  if (!installed.validation.valid) {
    throw new Error(formatValidationIssues(installed.validation.issues));
  }

  return installed;
}

export function removePack(
  name: string,
  projectRoot: string = process.cwd(),
  scope: 'global' | 'project' = 'global',
  overrides: Partial<PackManagerRoots> = {},
): void {
  const roots = resolvePackManagerRoots(projectRoot, overrides);
  const targetRoot = scope === 'project' ? roots.projectPacksRoot : roots.globalPacksRoot;
  const target = join(targetRoot, name);

  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    return;
  }

  const builtInRoot = join(roots.runtimeRoot, 'capabilities', 'coding', 'stacks', name);
  if (existsSync(builtInRoot)) {
    throw new Error(
      `Cannot remove built-in pack "${name}"; remove a global or project override instead`,
    );
  }

  throw new Error(`Pack "${name}" is not installed in ${scope} scope`);
}

export function validatePackAt(path: string): LoadedStackPack {
  const pack = new StackPackLoader().validatePack(resolve(path));
  if (!pack.validation.valid) {
    throw new Error(formatValidationIssues(pack.validation.issues));
  }
  return pack;
}

export function createPack(name: string, options: CreatePackOptions = {}): string {
  const destinationRoot = options.destinationRoot ?? process.cwd();
  const ecosystem = options.ecosystem ?? 'node';
  const tier = options.tier ?? 'framework';
  const packRoot = join(destinationRoot, name);

  if (existsSync(packRoot)) {
    throw new Error(`Pack scaffold already exists at ${packRoot}`);
  }

  mkdirSync(join(packRoot, 'rules'), { recursive: true });
  writeFileSync(join(packRoot, 'pack.yaml'), renderPackTemplate(name, ecosystem, tier));
  writeFileSync(
    join(packRoot, 'rules', 'conventions.md'),
    `# ${name}\n\nDocument project-specific conventions for the ${name} stack here.\n`,
  );

  return packRoot;
}

function listPackNamesForSource(source: PackInstallSource, roots: PackManagerRoots): string[] {
  const sourceRoot = resolveSourceRoot(source, roots);
  if (!existsSync(sourceRoot)) {
    return [];
  }

  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function resolveSourceRoot(source: PackInstallSource, roots: PackManagerRoots): string {
  if (source === 'built-in') {
    return join(roots.runtimeRoot, 'capabilities', 'coding', 'stacks');
  }
  return source === 'global' ? roots.globalPacksRoot : roots.projectPacksRoot;
}

async function materializePackSource(source: string, roots: PackManagerRoots): Promise<string> {
  if (looksLikeLocalPath(source)) {
    const resolved = resolve(source);
    return findPackRoot(resolved);
  }

  if (looksLikeGitUrl(source)) {
    return clonePackSource(source);
  }

  if (roots.registryUrl === undefined || roots.registryUrl === '') {
    throw new Error(
      `Cannot resolve bare pack name "${source}" without PAQAD_PACK_REGISTRY_URL configured`,
    );
  }

  return clonePackSource(buildRegistryPackUrl(roots.registryUrl, source));
}

function looksLikeLocalPath(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/') || existsSync(resolve(source));
}

function looksLikeGitUrl(source: string): boolean {
  return (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('ssh://') ||
    source.startsWith('git@') ||
    source.startsWith('file://') ||
    source.endsWith('.git')
  );
}

async function clonePackSource(source: string): Promise<string> {
  const tempRoot = mkdtempSync(join(homedir(), '.paqad-pack-clone-'));
  try {
    await execa('git', ['clone', '--depth', '1', source, tempRoot]);
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }

  return findPackRoot(tempRoot);
}

function findPackRoot(root: string): string {
  const rootManifest = join(root, 'pack.yaml');
  if (existsSync(rootManifest)) {
    return root;
  }

  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((candidate) => existsSync(join(candidate, 'pack.yaml')));

  if (candidates.length === 1) {
    return candidates[0];
  }

  throw new Error(`Could not find a pack.yaml in ${root}`);
}

function buildRegistryPackUrl(registryUrl: string, name: string): string {
  const normalized = registryUrl.endsWith('/') ? registryUrl.slice(0, -1) : registryUrl;
  return `${normalized}/${name}.git`;
}

function compareSources(left: PackInstallSource, right: PackInstallSource): number {
  return SOURCE_ORDER.indexOf(left) - SOURCE_ORDER.indexOf(right);
}

function renderPackTemplate(
  name: string,
  ecosystem: string,
  tier: 'framework' | 'archetype',
): string {
  const lines = [
    `name: ${name}`,
    `display_name: ${toDisplayName(name)}`,
    `ecosystem: ${ecosystem}`,
    'version: 1.0.0',
  ];

  if (tier === 'archetype') {
    lines.push('tier: archetype');
  }

  lines.push(`description: ${toDisplayName(name)} stack pack`, 'maintainer: your-team');

  if (tier === 'archetype') {
    lines.push(
      'detection:',
      '  manifests:',
      '    - file: package.json',
      '      fields:',
      `        - name: # TODO: add manifest field that identifies a ${name} project`,
      '          presence: required',
      '  heuristics: []',
    );
  } else {
    lines.push(
      'detection:',
      '  manifests:',
      '    - file: package.json',
      `      packages: [${name}]`,
    );
  }

  lines.push(
    'toolchains:',
    `  - ecosystem: ${ecosystem}`,
    '    package_managers: [pnpm]',
    '    lockfiles: [pnpm-lock.yaml]',
    'docs:',
    '  conventions_template: rules/conventions.md',
    '',
  );

  return lines.join('\n');
}

function toDisplayName(name: string): string {
  return name
    .split('-')
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatValidationIssues(
  issues: { level: string; path: string; message: string }[],
): string {
  return issues.map((issue) => `${issue.level}: ${issue.path} ${issue.message}`).join('\n');
}
