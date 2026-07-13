// File-to-module-slug resolver for the code-knowledge index (issue #353). The
// module map has no forward "which module owns this file" helper, so this builds
// one from each module's declared source paths. It is format-aware: this repo's
// hand-authored version:2 map uses `sources` (plus nested `features[].sources`);
// the generator's standard shape uses `source_paths`. Both are read, and the
// longest matching source path wins so the most specific module claims a file.
//
// Shared by the index builder (to stamp `module_slug` on every symbol) and the
// module-map evidence writer (to group symbols by module) — one resolver, not two.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

interface ModuleNode {
  slug?: unknown;
  sources?: unknown;
  source_paths?: unknown;
  features?: unknown;
}

interface SourceClaim {
  slug: string;
  /** A declared source path, normalised without a trailing slash. */
  prefix: string;
}

export interface ModuleSlugResolver {
  /** The owning module slug for a project-relative file, or null when none claims it. */
  slugForFile(relPath: string): string | null;
  /** Every module slug that declared at least one source path, in map order. */
  slugs(): string[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Collect every source path a module declares (its own + its features'). */
function claimsForModule(module: ModuleNode): string[] {
  const own = [...asStringArray(module.sources), ...asStringArray(module.source_paths)];
  const featureSources = Array.isArray(module.features)
    ? (module.features as ModuleNode[]).flatMap((feature) =>
        asStringArray(feature.sources).concat(asStringArray(feature.source_paths)),
      )
    : [];
  return [...own, ...featureSources];
}

/** Build a resolver from the project's module map. A missing/malformed map yields an empty resolver. */
export function loadModuleSlugResolver(projectRoot: string): ModuleSlugResolver {
  const claims: SourceClaim[] = [];
  const slugOrder: string[] = [];

  const mapPath = join(projectRoot, PATHS.MODULE_MAP);
  // Read directly and let the try/catch cover a missing OR malformed map (no
  // existsSync-then-read file-system race); either way the resolver is empty.
  try {
    const doc = parseYaml(readFileSync(mapPath, 'utf8')) as { modules?: unknown };
    const modules = Array.isArray(doc?.modules) ? (doc.modules as ModuleNode[]) : [];
    for (const module of modules) {
      if (typeof module.slug !== 'string') continue;
      const slug = module.slug;
      let claimed = false;
      for (const source of claimsForModule(module)) {
        const prefix = source.replace(/\/+$/, '');
        if (prefix.length > 0) {
          claims.push({ slug, prefix });
          claimed = true;
        }
      }
      if (claimed) slugOrder.push(slug);
    }
  } catch {
    // Missing or malformed map -> empty resolver; module_slug is simply null everywhere.
  }

  return {
    slugForFile(relPath: string): string | null {
      let best: SourceClaim | null = null;
      for (const claim of claims) {
        if (relPath === claim.prefix || relPath.startsWith(`${claim.prefix}/`)) {
          if (best === null || claim.prefix.length > best.prefix.length) {
            best = claim;
          }
        }
      }
      return best?.slug ?? null;
    },
    slugs(): string[] {
      return [...slugOrder];
    },
  };
}
