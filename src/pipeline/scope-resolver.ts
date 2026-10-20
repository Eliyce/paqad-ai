import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { ClassificationScope } from '@/core/types/classification.js';

const SCOPE_TIMEOUT_MS = 200;

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

  if (modulePaths.some((path) => CORE_MODULE_PATTERN.test(path))) {
    return { scope: 'system-wide', scope_graph_depth: 3 };
  }

  const ownRoots = new Set(modulePaths.map(topLevelModuleRoot));
  if (ownRoots.size === 1) {
    return { scope: 'single-module', scope_graph_depth: 0 };
  }

  const externalRoots = await withTimeout(
    scanExternalImportRoots(root, modulePaths, ownRoots),
    SCOPE_TIMEOUT_MS,
    new Set<string>(),
  );

  const totalRoots = new Set([...ownRoots, ...externalRoots]);
  const depth = Math.min(externalRoots.size, 3);
  const scope: ClassificationScope = totalRoots.size >= 4 ? 'system-wide' : 'multi-module';

  return { scope, scope_graph_depth: depth };
}

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
          if (!importPath.startsWith('.') && !importPath.startsWith('@/')) {
            continue;
          }
          const resolved = importPath.startsWith('@/') ? 'src/' + importPath.slice(2) : importPath;
          const importRoot = topLevelModuleRoot(resolved);
          if (!ownRoots.has(importRoot)) {
            external.add(importRoot);
          }
        }
      } catch {}
    }),
  );

  return external;
}

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
