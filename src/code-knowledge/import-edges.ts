import { scanImports } from '@/graph/import-scanner.js';

import type { CodeKnowledgeImportEdge, CodeKnowledgeReferenceEdge } from './types.js';

export const DEFAULT_ALIASES: Record<string, string> = { '@/': 'src/' };

const NAMED_BLOCK_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w$*]+\s*,\s*)?\{([^}]*)\}\s+from\s+["'][^"']+["']/g;

export function parseImportedNames(content: string): Set<string> {
  const names = new Set<string>();
  NAMED_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NAMED_BLOCK_RE.exec(content)) !== null) {
    for (const raw of match[1]!.split(',')) {
      const token = raw.trim().replace(/^type\s+/, '');
      if (token.length === 0) continue;
      const exported = token.split(/\s+as\s+/)[0]!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) {
        names.add(exported);
      }
    }
  }
  return names;
}

export interface BuildEdgesResult {
  importEdges: CodeKnowledgeImportEdge[];
  referenceEdges: CodeKnowledgeReferenceEdge[];
}

export async function buildEdges(
  projectRoot: string,
  files: string[],
  contentByFile: Map<string, string>,
  exportsByFile: Map<string, Set<string>>,
): Promise<BuildEdgesResult> {
  const importEdges = await scanImports({ projectRoot, files, aliases: DEFAULT_ALIASES });

  const referenceEdges: CodeKnowledgeReferenceEdge[] = [];
  const importedNamesByFile = new Map<string, Set<string>>();

  for (const edge of importEdges) {
    let imported = importedNamesByFile.get(edge.from);
    if (!imported) {
      imported = parseImportedNames(contentByFile.get(edge.from) ?? '');
      importedNamesByFile.set(edge.from, imported);
    }
    const exportsOfTarget = exportsByFile.get(edge.to);
    if (!exportsOfTarget) continue;
    for (const name of imported) {
      if (exportsOfTarget.has(name)) {
        referenceEdges.push({ from: edge.from, to: edge.to, symbol: name });
      }
    }
  }

  return { importEdges, referenceEdges };
}
