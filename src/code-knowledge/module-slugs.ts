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
  prefix: string;
}

export interface ModuleSlugResolver {
  slugForFile(relPath: string): string | null;
  slugs(): string[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function claimsForModule(module: ModuleNode): string[] {
  const own = [...asStringArray(module.sources), ...asStringArray(module.source_paths)];
  const featureSources = Array.isArray(module.features)
    ? (module.features as ModuleNode[]).flatMap((feature) =>
        asStringArray(feature.sources).concat(asStringArray(feature.source_paths)),
      )
    : [];
  return [...own, ...featureSources];
}

export function loadModuleSlugResolver(projectRoot: string): ModuleSlugResolver {
  const claims: SourceClaim[] = [];
  const slugOrder: string[] = [];

  const mapPath = join(projectRoot, PATHS.MODULE_MAP);
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
  } catch {}

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
