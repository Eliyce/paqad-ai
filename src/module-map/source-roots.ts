import { readProjectProfile } from '@/core/project-profile.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import type { LoadedStackPack, StackPackManifest } from '@/core/types/pack.js';
import { StackPackLoader } from '@/packs/loader.js';

export interface DiscoveredSourceRoots {
  source_roots: string[] | null;
  reason: 'pack' | 'profile-override' | 'unknown';
  pack_name: string | null;
}

function packModuleHealth(pack: LoadedStackPack): StackPackManifest['module_health'] {
  return pack.manifest.module_health;
}

export function discoverSourceRoots(projectRoot: string): DiscoveredSourceRoots {
  const profile = readProjectProfile(projectRoot);
  const requested = profile?.stack_profile?.frameworks ?? [];

  const loader = new StackPackLoader();
  const registry = loader.load({
    runtimeRoot: getRuntimeRoot(),
    projectRoot,
  });

  const orderedNames =
    requested.length > 0
      ? [...requested, ...Array.from(registry.packs.keys()).filter((n) => !requested.includes(n))]
      : Array.from(registry.packs.keys());

  for (const name of orderedNames) {
    const pack = registry.packs.get(name);
    if (pack === undefined) continue;
    const mh = packModuleHealth(pack);
    if (mh !== undefined && Array.isArray(mh.source_roots) && mh.source_roots.length > 0) {
      return { source_roots: mh.source_roots, reason: 'pack', pack_name: name };
    }
  }

  return { source_roots: null, reason: 'unknown', pack_name: null };
}

export interface DiscoveredModuleHealth {
  module_health: NonNullable<StackPackManifest['module_health']> | null;
  pack_name: string | null;
}

export function discoverModuleHealth(projectRoot: string): DiscoveredModuleHealth {
  const profile = readProjectProfile(projectRoot);
  const requested = profile?.stack_profile?.frameworks ?? [];

  const loader = new StackPackLoader();
  const registry = loader.load({
    runtimeRoot: getRuntimeRoot(),
    projectRoot,
  });

  const orderedNames =
    requested.length > 0
      ? [...requested, ...Array.from(registry.packs.keys()).filter((n) => !requested.includes(n))]
      : Array.from(registry.packs.keys());

  for (const name of orderedNames) {
    const pack = registry.packs.get(name);
    if (pack === undefined) continue;
    const mh = packModuleHealth(pack);
    if (mh !== undefined && Array.isArray(mh.source_roots) && mh.source_roots.length > 0) {
      return { module_health: mh, pack_name: name };
    }
  }

  return { module_health: null, pack_name: null };
}
