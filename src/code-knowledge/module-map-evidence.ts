import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

import type { CodeKnowledgeIndex } from './types.js';

export interface ModuleMapEvidenceResult {
  written: boolean;
  modulesUpdated: number;
}

const NOT_WRITTEN: ModuleMapEvidenceResult = { written: false, modulesUpdated: 0 };

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

export function writeModuleMapEvidence(
  projectRoot: string,
  index: CodeKnowledgeIndex,
): ModuleMapEvidenceResult {
  const mapPath = join(projectRoot, PATHS.MODULE_MAP);

  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(readFileSync(mapPath, 'utf8'));
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
      evidence.set('symbols', symbolsNode);
    } else {
      item.set('evidence', doc.createNode({ symbols: names }));
    }
    modulesUpdated += 1;
  }

  if (modulesUpdated === 0) return NOT_WRITTEN;
  writeFileSync(mapPath, doc.toString({ flowCollectionPadding: false, lineWidth: 0 }), 'utf8');
  return { written: true, modulesUpdated };
}
