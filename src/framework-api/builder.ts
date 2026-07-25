// Building the installed framework-API index (issue #397).
//
// Which packages get indexed comes from the stack snapshot crossed with the SHARED
// `FRAMEWORK_PACKAGE_MAP` — the same map stack detection already uses, not a second copy
// of the same knowledge. What VERSION each is at comes from the installed package's own
// manifest, never from the snapshot's `locked_version`, which mirrors the manifest range
// (FR-2).
//
// Every package that produces no entry is recorded in `blocked` with a reason. A silently
// missing package would read as "checked and fine", which is the failure mode this whole
// index exists to prevent.

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
  /** Injectable for tests; defaults to the project's persisted snapshot. */
  snapshot?: StackSnapshot | null;
  /** Injectable for tests and for #398's adapters. */
  registry?: FrameworkApiAdapterRegistry;
  /** Injectable clock, so a built index is reproducible under test. */
  now?: () => Date;
  /** Ignore the previous index and re-walk every package. */
  force?: boolean;
}

export interface BuildFrameworkApiResult {
  index: FrameworkApiIndex;
  /** How many packages reused a stored entry rather than being re-walked (FR-13). */
  cacheHits: number;
}

/**
 * Build the index for every detected framework in the project's stack snapshot.
 *
 * A package is re-walked only when its content address changed, so a rebuild at unchanged
 * versions is a cache hit and stays inside the time budget (AC-7).
 */
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

  for (const dependency of snapshot?.packages ?? []) {
    if (FRAMEWORK_PACKAGE_MAP[dependency.name] === undefined) {
      continue;
    }
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
    const installed = adapter.resolveInstalled(projectRoot, dependency.name);
    if (installed === null) {
      blocked.push({
        package: dependency.name,
        ecosystem: dependency.ecosystem,
        reason: 'not-installed',
        detail: `${dependency.name} is declared but not present in the install tree — run your package manager's install`,
      });
      continue;
    }

    const input = {
      projectRoot,
      package: dependency.name,
      version: installed.version,
      packageDir: installed.dir,
    };
    const contentHash = adapter.contentHash(input);
    const stored = previous?.packages.find(
      (entry) => entry.package === dependency.name && entry.content_hash === contentHash,
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
