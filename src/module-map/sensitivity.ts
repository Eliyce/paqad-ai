import { isAbsolute, relative } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';

import { readRawModuleMap, type ModuleSensitivity } from './reconciler.js';

function normalise(path: string): string {
  return toPosixPath(path).replace(/^\.\//, '').replace(/\/+$/, '');
}

function underPrefix(target: string, prefix: string): boolean {
  if (prefix.length === 0) {
    return false;
  }
  return target === prefix || target.startsWith(`${prefix}/`);
}

export function resolvePathSensitivity(projectRoot: string, relPath: string): ModuleSensitivity {
  const map = readRawModuleMap(projectRoot);
  if (!map) {
    return 'normal';
  }
  const rel = isAbsolute(relPath) ? relative(projectRoot, relPath) : relPath;
  const target = normalise(rel);
  if (target.length === 0) {
    return 'normal';
  }
  for (const mod of map.modules) {
    if (mod.sensitivity !== 'high') {
      continue;
    }
    const prefixes = [...mod.sources, ...mod.features.flatMap((feature) => feature.sources)];
    if (prefixes.some((source) => underPrefix(target, normalise(source)))) {
      return 'high';
    }
  }
  return 'normal';
}
