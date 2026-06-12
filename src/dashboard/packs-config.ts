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

/**
 * Issue #146 — `GET /api/packs` plus the install and remove mutations (spec
 * section 6.1). Listing enumerates pack directories the way
 * {@link StackPackLoader} discovers them, but validates each one explicitly
 * so invalid packs stay visible with `valid: false` instead of being
 * quarantined out of the list. Install and remove reuse the exact core
 * functions the `paqad-ai packs` CLI calls, with a name guard in front of
 * remove so no filesystem path is ever built from an unvetted name.
 */

/** Same source precedence as the loader: later sources override earlier. */
const SOURCE_ORDER = ['built-in', 'global', 'project'] as const;

export type PackSource = (typeof SOURCE_ORDER)[number];

/**
 * Safe pack-name shape, checked before any filesystem path is built from a
 * client-supplied name. Deliberately at least as strict as the manifest
 * schema's `^[a-z0-9]+(?:-[a-z0-9]+)*$` on the traversal-relevant characters.
 */
const PACK_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Thrown when a client-supplied pack name fails the safety pattern. */
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
  /** The winning source after override precedence (project > global > built-in). */
  source: PackSource;
  version: string;
  valid: boolean;
}

/** Test hooks; production callers pass nothing and get the real roots. */
export type PacksRootsOverrides = Partial<
  Pick<PackManagerRoots, 'runtimeRoot' | 'globalPacksRoot' | 'projectPacksRoot'>
>;

function sourceRootFor(source: PackSource, roots: PackManagerRoots): string {
  if (source === 'built-in') {
    return join(roots.runtimeRoot, 'capabilities', 'coding', 'stacks');
  }
  return source === 'global' ? roots.globalPacksRoot : roots.projectPacksRoot;
}

/**
 * The effective pack list: every discoverable pack with its winning source,
 * manifest version, and validation verdict. Sorted by name.
 */
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
      // Convention directories (`_shared`, VCS metadata) are never packs —
      // same rule the loader applies during discovery.
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
  /** Local path, git URL, or registry name — same forms the CLI accepts. */
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

/**
 * Install a pack through the CLI's core path ({@link installPackCore}), which
 * validates the manifest — including the schema's strict name pattern —
 * before anything is copied into the scope directory. Audited as
 * `dashboard.packs.install`.
 */
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

/**
 * Remove a global or project pack override through the CLI's core path
 * ({@link removePackCore}), which refuses built-in packs. The name is checked
 * against {@link PACK_NAME_PATTERN} first so the removal path can never be
 * steered outside the scope directory. Audited as `dashboard.packs.remove`.
 */
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
