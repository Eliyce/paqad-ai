import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { parse } from 'yaml';

import { readTextOrNull } from './io.js';

export const MODULE_MAP_PATH = 'docs/instructions/rules/module-map.yml';

export interface ModuleUnit {
  slug: string;
  source_hash: string;
}

interface ModuleEntry {
  slug?: unknown;
  sources?: unknown;
  features?: Array<{ slug?: unknown; sources?: unknown }>;
}

export function readModuleUnits(projectRoot: string): ModuleUnit[] | null {
  const text = readTextOrNull(join(projectRoot, MODULE_MAP_PATH));
  if (text === null) return null;
  const doc = parse(text) as { modules?: ModuleEntry[] } | null;
  if (!doc || !Array.isArray(doc.modules)) return null;
  return doc.modules
    .filter((entry): entry is ModuleEntry & { slug: string } => typeof entry.slug === 'string')
    .map((entry) => ({ slug: entry.slug, source_hash: moduleSourceHash(entry) }));
}

function moduleSourceHash(entry: ModuleEntry): string {
  const shape = {
    sources: entry.sources ?? [],
    features: (entry.features ?? []).map((feature) => ({
      slug: feature.slug,
      sources: feature.sources ?? [],
    })),
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}
