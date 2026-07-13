// Module-map evidence writer (issue #353, decision D-01KXD2Q175MVR5YXWKTWJR73NB).
// Fills each module's `evidence.symbols` in docs/instructions/rules/module-map.yml
// with the exported symbols the index attributes to it, so the reuse consumer can
// see a module's surface. Comment-preserving via the YAML Document API (the same
// idiom generateModuleMapYaml uses): only the `symbols` key is added/replaced, so
// hand-authored comments, ordering, and any existing evidence (routes/tables)
// survive (INV-5). Format-aware — it edits whatever module nodes exist, so this
// repo's version:2 map and the generator's standard shape both work.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

import type { CodeKnowledgeIndex } from './types.js';

export interface ModuleMapEvidenceResult {
  written: boolean;
  modulesUpdated: number;
}

const NOT_WRITTEN: ModuleMapEvidenceResult = { written: false, modulesUpdated: 0 };

/** Group the index's exported symbol names by owning module slug (sorted, deduped). */
function symbolNamesBySlug(index: CodeKnowledgeIndex): Map<string, string[]> {
  const bySlug = new Map<string, Set<string>>();
  for (const symbol of index.symbols) {
    if (symbol.module_slug === null) continue;
    const set = bySlug.get(symbol.module_slug) ?? new Set<string>();
    set.add(symbol.name);
    bySlug.set(symbol.module_slug, set);
  }
  const sorted = new Map<string, string[]>();
  for (const [slug, names] of bySlug) {
    sorted.set(slug, [...names].sort());
  }
  return sorted;
}

/**
 * Write `evidence.symbols` into every module the index has symbols for, preserving
 * the rest of the map. A missing or malformed map, or a map no module matched, is a
 * no-op (nothing written).
 */
export function writeModuleMapEvidence(
  projectRoot: string,
  index: CodeKnowledgeIndex,
): ModuleMapEvidenceResult {
  const mapPath = join(projectRoot, PATHS.MODULE_MAP);
  if (!existsSync(mapPath)) return NOT_WRITTEN;

  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(readFileSync(mapPath, 'utf8'));
    /* v8 ignore next 3 -- defensive: existsSync-then-read race, or a rare tokenizer throw */
  } catch {
    return NOT_WRITTEN;
  }
  const modules = doc.get('modules');
  if (!YAML.isSeq(modules)) return NOT_WRITTEN;

  const bySlug = symbolNamesBySlug(index);
  let modulesUpdated = 0;
  for (const item of modules.items) {
    if (!YAML.isMap(item)) continue;
    const slug = item.get('slug');
    if (typeof slug !== 'string') continue;
    const names = bySlug.get(slug);
    if (names === undefined || names.length === 0) continue;

    const symbolsNode = doc.createNode(names);
    const evidence = item.get('evidence');
    if (YAML.isMap(evidence)) {
      evidence.set('symbols', symbolsNode); // keep existing routes/tables
    } else {
      item.set('evidence', doc.createNode({ symbols: names }));
    }
    modulesUpdated += 1;
  }

  if (modulesUpdated === 0) return NOT_WRITTEN;
  // Preserve the hand-authored flow-array style (`[a, b]`, no inner padding, no
  // re-wrapping) so the diff is the evidence additions, not cosmetic churn (INV-5).
  writeFileSync(mapPath, doc.toString({ flowCollectionPadding: false, lineWidth: 0 }), 'utf8');
  return { written: true, modulesUpdated };
}
