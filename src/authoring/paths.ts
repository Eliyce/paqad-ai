import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { deriveRecordedProviders } from '@/adapters/recorded-providers.js';
import { BaseAdapter } from '@/adapters/shared/base-adapter.js';
import { PATHS } from '@/core/constants/paths.js';
import { ADAPTER_TYPES, type AdapterType } from '@/core/types/adapter.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';

import { AGENT_HOST_TARGETS, isSubagentCapableAdapter } from './package/agent-render.js';

export const OPEN_STANDARD_SKILLS_ROOT = '.agents/skills';

export const PAQAD_REPO_SKILL_ROOTS: readonly string[] = [
  'runtime/base/skills',
  'runtime/claude-plugin/skills',
  'runtime/capabilities/*/skills',
];

export const SKILL_FILE = 'SKILL.md';

export const PAQAD_REPO_AGENT_ROOTS: readonly string[] = [
  'runtime/claude-plugin/agents',
  'runtime/base/agents',
  'runtime/capabilities/*/agents',
  'runtime/templates/stage-agents',
];

const PAQAD_PACKAGE_NAME = 'paqad-ai';

export interface SkillPathOptions {
  paqadRepo?: boolean;
}

export interface SkillPathContext {
  adapters: readonly AdapterType[];
  paqadRepo: boolean;
}

const hostRootCache = new Map<AdapterType, string | null>();

function hostSkillsRoot(type: AdapterType): string | null {
  if (!hostRootCache.has(type)) {
    const adapter = AdapterFactory.create(type);
    hostRootCache.set(type, adapter instanceof BaseAdapter ? adapter.getSkillsRoot() : null);
  }
  return hostRootCache.get(type) ?? null;
}

const agentRootCache = new Map<AdapterType, string | null>();

function hostAgentsRoot(type: AdapterType): string | null {
  if (!agentRootCache.has(type)) {
    const adapter = AdapterFactory.create(type);
    agentRootCache.set(type, adapter instanceof BaseAdapter ? adapter.getAgentsRoot() : null);
  }
  return agentRootCache.get(type) ?? null;
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(\.\/)+/u, '');
}

export function skillRoots(
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): string[] {
  const roots = new Set<string>();
  for (const type of adapters) {
    const root = hostSkillsRoot(type);
    if (root !== null) roots.add(normalize(root).replace(/\/+$/u, ''));
  }
  roots.add(OPEN_STANDARD_SKILLS_ROOT);
  if (options.paqadRepo === true) {
    for (const root of PAQAD_REPO_SKILL_ROOTS) roots.add(root);
  }
  return [...roots];
}

function matchRoot(segments: readonly string[], root: readonly string[]): boolean {
  if (segments.length <= root.length) return false;
  return root.every((part, index) => part === '*' || part === segments[index]);
}

function folderFromSegments(
  segments: readonly string[],
  roots: readonly string[][],
): { name: string; folder: string } | null {
  for (const root of roots) {
    if (!matchRoot(segments, root)) continue;
    const rest = segments.slice(root.length);
    if (rest.length >= 2 && rest[0] !== '') {
      return { name: rest[0]!, folder: segments.slice(0, root.length + 1).join('/') };
    }
  }
  return null;
}

function nameFromSegments(segments: readonly string[], roots: readonly string[][]): string | null {
  return folderFromSegments(segments, roots)?.name ?? null;
}

function splitRoots(adapters: readonly AdapterType[], options: SkillPathOptions): string[][] {
  return skillRoots(adapters, options).map((root) => root.split('/'));
}

export function skillNameOf(
  path: string,
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): string | null {
  return nameFromSegments(normalize(path).split('/'), splitRoots(adapters, options));
}

export function skillFolderOf(
  path: string,
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): { name: string; folder: string } | null {
  return folderFromSegments(normalize(path).split('/'), splitRoots(adapters, options));
}

export function isSkillPath(
  path: string,
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): boolean {
  return skillNameOf(path, adapters, options) !== null;
}

export function findSkillPaths(
  files: readonly string[],
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): string[] {
  const roots = splitRoots(adapters, options);
  return files.filter((file) => nameFromSegments(normalize(file).split('/'), roots) !== null);
}

export function agentRoots(
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): string[] {
  const roots = new Set<string>();
  for (const type of adapters) {
    if (!isSubagentCapableAdapter(type, AGENT_HOST_TARGETS)) continue;
    const root = hostAgentsRoot(type);
    if (root !== null) roots.add(normalize(root).replace(/\/+$/u, ''));
  }
  if (options.paqadRepo === true) {
    for (const root of PAQAD_REPO_AGENT_ROOTS) roots.add(root);
  }
  return [...roots];
}

function agentStem(file: string): string {
  return file.replace(/\.hbs$/u, '').replace(/\.[^.]+$/u, '');
}

function agentNameFromSegments(
  segments: readonly string[],
  roots: readonly string[][],
): string | null {
  for (const root of roots) {
    if (!matchRoot(segments, root)) continue;
    const rest = segments.slice(root.length);
    if (rest.length !== 1) continue;
    const stem = agentStem(rest[0]!);
    if (stem !== '' && !stem.startsWith('.')) return stem;
  }
  return null;
}

function splitAgentRoots(adapters: readonly AdapterType[], options: SkillPathOptions): string[][] {
  return agentRoots(adapters, options).map((root) => root.split('/'));
}

export function agentNameOf(
  path: string,
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): string | null {
  return agentNameFromSegments(normalize(path).split('/'), splitAgentRoots(adapters, options));
}

export function isAgentPath(
  path: string,
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): boolean {
  return agentNameOf(path, adapters, options) !== null;
}

export function findAgentPaths(
  files: readonly string[],
  adapters: readonly AdapterType[],
  options: SkillPathOptions = {},
): string[] {
  const roots = splitAgentRoots(adapters, options);
  return files.filter((file) => agentNameFromSegments(normalize(file).split('/'), roots) !== null);
}

export function enabledAdapters(projectRoot: string): AdapterType[] {
  let manifest: OnboardingManifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(projectRoot, PATHS.ONBOARDING_MANIFEST), 'utf8'),
    ) as OnboardingManifest;
  } catch {
    return [...ADAPTER_TYPES];
  }
  if (!(ADAPTER_TYPES as readonly string[]).includes(manifest.adapter)) {
    return [...ADAPTER_TYPES];
  }
  return deriveRecordedProviders({
    ...manifest,
    generated_artifacts: manifest.generated_artifacts ?? [],
  });
}

export function isPaqadRepository(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    return pkg.name === PAQAD_PACKAGE_NAME;
  } catch {
    return false;
  }
}

export function readSkillPathContext(projectRoot: string): SkillPathContext {
  return { adapters: enabledAdapters(projectRoot), paqadRepo: isPaqadRepository(projectRoot) };
}
