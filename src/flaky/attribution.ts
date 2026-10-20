import { toPosixPath } from '@/core/path-utils.js';
import type { FlakyRegistry, ModuleQuarantineCount } from '@/core/types/flaky.js';
import { _matchesAnyGlob, readRawModuleMap } from '@/module-map/reconciler.js';

import { activeQuarantines } from './registry.js';

export function modulesForFile(projectRoot: string, filePath: string | null): string[] {
  if (!filePath) {
    return [];
  }
  const map = readRawModuleMap(projectRoot);
  if (!map) {
    return [];
  }
  const normalised = toPosixPath(filePath);
  const slugs: string[] = [];
  for (const mod of map.modules) {
    if (_matchesAnyGlob(normalised, mod.sources)) {
      slugs.push(mod.slug);
    }
  }
  return slugs;
}

export function modulesForFiles(projectRoot: string, files: string[]): string[] {
  const map = readRawModuleMap(projectRoot);
  if (!map) {
    return [];
  }
  const touched = new Set<string>();
  for (const file of files) {
    const normalised = toPosixPath(file);
    for (const mod of map.modules) {
      if (_matchesAnyGlob(normalised, mod.sources)) {
        touched.add(mod.slug);
      }
    }
  }
  return [...touched].sort();
}

export function quarantineCountsByModule(registry: FlakyRegistry): ModuleQuarantineCount[] {
  const counts = new Map<string, number>();
  for (const entry of activeQuarantines(registry)) {
    for (const module of entry.modules) {
      counts.set(module, (counts.get(module) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([module, quarantined]) => ({ module, quarantined }))
    .sort((a, b) => a.module.localeCompare(b.module));
}
