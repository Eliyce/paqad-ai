import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { ClassificationScope } from '@/core/types/classification.js';

const SCOPE_TIMEOUT_MS = 200;

/**
 * Touching core/shared types almost always propagates changes system-wide,
 * so we classify those paths as system-wide immediately without counting modules.
 */
const CORE_MODULE_PATTERN = /\b(?:src|lib)\/(?:core|shared|types|utils|common)\b/;

export interface ScopeResolutionResult {
  scope: ClassificationScope;
  scope_graph_depth: number;
}

export async function resolveScope(
  root: string,
  modulePaths: string[],
): Promise<ScopeResolutionResult> {
  if (modulePaths.length === 0) {
    return { scope: 'single-module', scope_graph_depth: 0 };
  }

  if (modulePaths.length === 1) {
    return { scope: 'single-file', scope_graph_depth: 0 };
  }

  // Touching core/shared is always system-wide.
  if (modulePaths.some((path) => CORE_MODULE_PATTERN.test(path))) {
    return { scope: 'system-wide', scope_graph_depth: 3 };
  }

  // All paths within the same top-level module directory → single-module.
  const ownRoots = new Set(modulePaths.map(topLevelModuleRoot));
  if (ownRoots.size === 1) {
    return { scope: 'single-module', scope_graph_depth: 0 };
  }

  // Perform a 1-hop import scan bounded by the 200ms timeout.
  const externalRoots = await withTimeout(
    scanExternalImportRoots(root, modulePaths, ownRoots),
    SCOPE_TIMEOUT_MS,
    new Set<string>(),
  );

  const totalRoots = new Set([...ownRoots, ...externalRoots]);
  // depth = number of external module roots pulled in by the 1-hop scan, capped at 3.
  const depth = Math.min(externalRoots.size, 3);
  // ownRoots.size >= 2 at this point so totalRoots.size >= 2 always.
  const scope: ClassificationScope = totalRoots.size >= 4 ? 'system-wide' : 'multi-module';

  return { scope, scope_graph_depth: depth };
}

/**
 * Reads up to 8 affected files and collects the top-level module roots of any
 * project-internal imports (relative paths and @/ alias) that fall outside the
 * affected files' own module roots.
 */
async function scanExternalImportRoots(
  root: string,
  modulePaths: string[],
  ownRoots: Set<string>,
): Promise<Set<string>> {
  const external = new Set<string>();

  await Promise.all(
    modulePaths.slice(0, 8).map(async (modulePath) => {
      try {
        const content = await readFile(join(root, modulePath), 'utf8');
        const matches = Array.from(
          content.matchAll(
            /(?:import|export).+?from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g,
          ),
        );
        for (const match of matches) {
          const importPath = (match[1] ?? match[2])!.trim();
          // Only project-internal imports: relative or @/ alias.
          if (!importPath.startsWith('.') && !importPath.startsWith('@/')) {
            continue;
          }
          const resolved = importPath.startsWith('@/') ? 'src/' + importPath.slice(2) : importPath;
          const importRoot = topLevelModuleRoot(resolved);
          if (!ownRoots.has(importRoot)) {
            external.add(importRoot);
          }
        }
      } catch {
        // Best effort — file may not be accessible.
      }
    }),
  );

  return external;
}

/**
 * Returns the first two path segments of a module path, which serves as a
 * stable identifier for the owning module directory.
 * e.g. "src/pipeline/classifier" → "src/pipeline"
 *      "app/Http/Controllers/UserController" → "app/Http"
 */
function topLevelModuleRoot(modulePath: string): string {
  const normalized = modulePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  return parts.slice(0, 2).join('/');
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function toProjectRelativeModule(root: string, filePath: string): string {
  return relative(root, filePath).replace(/\\/g, '/');
}
