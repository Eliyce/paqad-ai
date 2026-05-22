import type { LoadedStackPack, StackPackManifest, StackPackTestRunner } from '@/core/types/pack.js';

import { StackPackLoader } from './loader.js';
import { resolvePackManagerRoots } from './manager.js';

export function loadProjectPackRegistry(projectRoot?: string) {
  const roots = resolvePackManagerRoots(projectRoot);
  return new StackPackLoader().load({
    runtimeRoot: roots.runtimeRoot,
    globalPacksRoot: roots.globalPacksRoot,
    projectRoot,
  });
}

export function getPacksForFrameworks(
  frameworks: string[],
  projectRoot?: string,
): LoadedStackPack[] {
  const registry = loadProjectPackRegistry(projectRoot);
  return frameworks
    .map((framework) => registry.packs.get(framework))
    .filter((pack): pack is LoadedStackPack => pack !== undefined);
}

export function getPackManifestMap(
  frameworks: string[],
  projectRoot?: string,
): Map<string, StackPackManifest> {
  return new Map(
    getPacksForFrameworks(frameworks, projectRoot).map((pack) => [
      pack.manifest.name,
      pack.manifest,
    ]),
  );
}

export function getPackTestRunners(
  frameworks: string[],
  projectRoot?: string,
): StackPackTestRunner[] {
  const packs = getPacksForFrameworks(frameworks, projectRoot);
  const deduped = new Map<string, StackPackTestRunner>();

  for (const pack of orderPacksForRunnerPrecedence(packs)) {
    for (const runner of pack.manifest.test_runners ?? []) {
      deduped.delete(runner.runner_id);
      deduped.set(runner.runner_id, runner);
    }
  }

  return [...deduped.values()];
}

function orderPacksForRunnerPrecedence(packs: LoadedStackPack[]): LoadedStackPack[] {
  const priority = new Map([
    ['built-in', 0],
    ['global', 1],
    ['project', 2],
  ] as const);

  return [...packs].sort((left, right) => priority.get(left.source)! - priority.get(right.source)!);
}
