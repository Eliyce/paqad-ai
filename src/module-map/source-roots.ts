// source_roots discovery from the active stack pack(s). Issue #80, Phase 2.
//
// Phase 2 ships the discovery plumbing; Phase 3 populates every shipped pack
// with a module_health.source_roots entry. Until then, discovery returns
// null and the reconciler hard-fails with `blocked: source_roots_unknown` —
// which is the spec-required behaviour (AC #17, no silent fallback).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readProjectProfile } from '@/core/project-profile.js';
import type { LoadedStackPack, StackPackManifest } from '@/core/types/pack.js';
import { StackPackLoader } from '@/packs/loader.js';

// Resolve the runtime root at module load. The framework ships its packs
// under `runtime/capabilities/coding/stacks/`; this resolver climbs from
// dist/src up to the package root the same way other framework callers do.
function resolveRuntimeRoot(): string {
  // When bundled by tsup we live in dist/; the runtime/ tree is alongside it.
  // When sourced via vitest we live in src/. Climb to find runtime/.
  const here = dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 10; i++) {
    const candidate = join(cur, 'runtime');
    if (existsSync(candidate)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return here;
}

export interface DiscoveredSourceRoots {
  source_roots: string[] | null;
  reason: 'pack' | 'profile-override' | 'unknown';
  pack_name: string | null;
}

function packModuleHealth(pack: LoadedStackPack): StackPackManifest['module_health'] {
  return pack.manifest.module_health;
}

// Walk the active stack packs for the project; return the first
// module_health.source_roots found, in pack-priority order (project >
// global > built-in). Returns null when no pack declares it — the
// reconciler will surface this to the user with the actionable message.
export function discoverSourceRoots(projectRoot: string): DiscoveredSourceRoots {
  const profile = readProjectProfile(projectRoot);
  const requested = profile?.stack_profile?.frameworks ?? [];

  const loader = new StackPackLoader();
  const registry = loader.load({
    runtimeRoot: resolveRuntimeRoot(),
    projectRoot,
  });

  // Try requested packs first; otherwise walk every loaded pack so projects
  // without a profile still get a result if any pack declares the block.
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
