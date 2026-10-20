import { join } from 'node:path';

import { FRAMEWORK_PACKAGE_MAP } from '@/core/stack-profile.js';
import type { StackSnapshot } from '@/core/types/introspection.js';
import { readStackSnapshotSync } from '@/introspection/cache.js';

import {
  createDefaultFrameworkApiAdapterRegistry,
  type FrameworkApiAdapterRegistry,
} from './adapters/registry.js';
import { readFrameworkApiIndex } from './store.js';
import {
  FRAMEWORK_API_SCHEMA_VERSION,
  type FrameworkApiBlocked,
  type FrameworkApiIndex,
  type FrameworkApiPackage,
} from './types.js';

export interface BuildFrameworkApiOptions {
  snapshot?: StackSnapshot | null;
  registry?: FrameworkApiAdapterRegistry;
  now?: () => Date;
  force?: boolean;
}

export interface BuildFrameworkApiResult {
  index: FrameworkApiIndex;
  cacheHits: number;
}

export function buildFrameworkApiIndex(
  projectRoot: string,
  options: BuildFrameworkApiOptions = {},
): BuildFrameworkApiResult {
  const snapshot =
    options.snapshot !== undefined ? options.snapshot : readStackSnapshotSync(projectRoot);
  const registry = options.registry ?? createDefaultFrameworkApiAdapterRegistry();
  const now = options.now ?? (() => new Date());
  const previous = options.force === true ? null : readFrameworkApiIndex(projectRoot);

  const packages: FrameworkApiPackage[] = [];
  const blocked: FrameworkApiBlocked[] = [];
  let cacheHits = 0;

  const seen = new Set<string>();
  for (const dependency of snapshot?.packages ?? []) {
    if (FRAMEWORK_PACKAGE_MAP[dependency.name] === undefined) {
      continue;
    }
    const root = dependency.root ?? '.';
    const pairKey = `${dependency.name}@@${root}`;
    if (seen.has(pairKey)) {
      continue;
    }
    seen.add(pairKey);

    const adapter = registry.get(dependency.ecosystem);
    if (adapter === null) {
      blocked.push({
        package: dependency.name,
        ecosystem: dependency.ecosystem,
        reason: 'no-adapter',
        detail: `no framework-API adapter for the ${dependency.ecosystem} ecosystem yet`,
      });
      continue;
    }
    const searchRoot = join(projectRoot, root);
    const installed = adapter.resolveInstalled(searchRoot, dependency.name);
    if (installed === null) {
      blocked.push({
        package: dependency.name,
        ecosystem: dependency.ecosystem,
        reason: 'not-installed',
        detail: `${dependency.name} is declared in ${root} but not present in its install tree — run your package manager's install`,
      });
      continue;
    }

    const input = {
      projectRoot,
      searchRoot,
      package: dependency.name,
      version: installed.version,
      packageDir: installed.dir,
    };
    const contentHash = adapter.contentHash(input);
    const stored = previous?.packages.find(
      (entry) =>
        entry.package === dependency.name &&
        entry.root === root &&
        entry.content_hash === contentHash,
    );
    if (stored) {
      packages.push(stored);
      cacheHits += 1;
      continue;
    }

    const result = adapter.index(input);
    if (!result.indexed) {
      blocked.push({
        package: dependency.name,
        ecosystem: dependency.ecosystem,
        reason: result.reason,
        detail: result.detail,
      });
      continue;
    }
    packages.push({
      package: dependency.name,
      version: installed.version,
      ecosystem: dependency.ecosystem,
      root,
      content_hash: contentHash,
      sources: result.sources,
      symbols: result.symbols,
    });
  }

  return {
    index: {
      schema_version: FRAMEWORK_API_SCHEMA_VERSION,
      header: {
        generated_at: now().toISOString(),
        schema_version: FRAMEWORK_API_SCHEMA_VERSION,
      },
      packages: packages.sort((left, right) => left.package.localeCompare(right.package)),
      blocked: blocked.sort((left, right) => left.package.localeCompare(right.package)),
    },
    cacheHits,
  };
}
