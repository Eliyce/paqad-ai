import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { StackPackLoader } from '@/packs/loader.js';
import {
  installPack as installPackCore,
  removePack as removePackCore,
  resolvePackManagerRoots,
  type PackManagerRoots,
} from '@/packs/manager.js';

import { appendDashboardAudit } from './approvals.js';

const SOURCE_ORDER = ['built-in', 'global', 'project'] as const;

export type PackSource = (typeof SOURCE_ORDER)[number];

const PACK_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class PackNameError extends Error {
  constructor(name: string) {
    super(
      `Pack name '${name}' is not valid: names are lowercase letters, digits, and dashes only.`,
    );
    this.name = 'PackNameError';
  }
}

export interface DashboardPack {
  name: string;
  source: PackSource;
  version: string;
  valid: boolean;
}

export type PacksRootsOverrides = Partial<
  Pick<PackManagerRoots, 'runtimeRoot' | 'globalPacksRoot' | 'projectPacksRoot'>
>;

function sourceRootFor(source: PackSource, roots: PackManagerRoots): string {
  if (source === 'built-in') {
    return join(roots.runtimeRoot, 'capabilities', 'coding', 'stacks');
  }
  return source === 'global' ? roots.globalPacksRoot : roots.projectPacksRoot;
}

export function listPacks(
  projectRoot: string,
  overrides: PacksRootsOverrides = {},
): DashboardPack[] {
  const roots = resolvePackManagerRoots(projectRoot, overrides);
  const loader = new StackPackLoader();
  const byName = new Map<string, DashboardPack>();

  for (const source of SOURCE_ORDER) {
    const sourceRoot = sourceRootFor(source, roots);
    if (!existsSync(sourceRoot)) {
      continue;
    }
    const packDirs = readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith('_') && !entry.name.startsWith('.'));

    for (const entry of packDirs) {
      const pack = loader.validatePack(join(sourceRoot, entry.name), source);
      byName.set(pack.manifest.name, {
        name: pack.manifest.name,
        source,
        version: pack.manifest.version,
        valid: pack.validation.valid,
      });
    }
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export interface InstallPackInput {
  source: string;
  scope?: 'global' | 'project';
  roots?: PacksRootsOverrides;
}

export interface InstallPackResult {
  name: string;
  version: string;
  scope: 'global' | 'project';
  root: string;
}

export async function installPack(
  projectRoot: string,
  input: InstallPackInput,
): Promise<InstallPackResult> {
  const scope = input.scope ?? 'global';
  const pack = await installPackCore(input.source, {
    projectRoot,
    scope,
    roots: input.roots,
  });

  appendDashboardAudit(projectRoot, 'dashboard.packs.install', {
    pack: pack.manifest.name,
    scope,
    source: input.source,
  });

  return {
    name: pack.manifest.name,
    version: pack.manifest.version,
    scope,
    root: pack.root,
  };
}

export interface RemovePackInput {
  name: string;
  scope?: 'global' | 'project';
  roots?: PacksRootsOverrides;
}

export interface RemovePackResult {
  name: string;
  scope: 'global' | 'project';
  removed: true;
}

export function removePack(projectRoot: string, input: RemovePackInput): RemovePackResult {
  if (!PACK_NAME_PATTERN.test(input.name)) {
    throw new PackNameError(input.name);
  }
  const scope = input.scope ?? 'global';
  removePackCore(input.name, projectRoot, scope, input.roots);

  appendDashboardAudit(projectRoot, 'dashboard.packs.remove', {
    pack: input.name,
    scope,
  });

  return { name: input.name, scope, removed: true };
}
