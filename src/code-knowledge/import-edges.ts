// Import + reference edges for the code-knowledge index (issue #353). File-to-file
// edges reuse the existing `scanImports` (TS/JS only) so there is one resolver, not
// two. File-to-symbol reference edges are resolved by import-name matching: for each
// resolved file edge, an imported name the target file exports becomes a reference
// edge, with NO type resolution (the honest v1 limit). A name two imported modules
// both export can be mis-attributed; acceptable for a coarse reuse signal, and noted
// so a consumer can weight it.

import { scanImports } from '@/graph/import-scanner.js';

import type { CodeKnowledgeImportEdge, CodeKnowledgeReferenceEdge } from './types.js';

/** The tsconfig path alias this repo (and most onboarded TS stacks) use. */
export const DEFAULT_ALIASES: Record<string, string> = { '@/': 'src/' };

const NAMED_BLOCK_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w$*]+\s*,\s*)?\{([^}]*)\}\s+from\s+["'][^"']+["']/g;

/**
 * The set of exported names a file imports (or re-exports) by name. Captures the
 * original exported name (the left side of `as`) so it matches the target file's
 * exported symbol. Default and namespace imports are out of scope (no named symbol
 * to match); type-only imports ARE included (they reference exported types).
 */
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

/**
 * Resolve the file-to-file import edges (via `scanImports`) and the file-to-symbol
 * reference edges (import-name matching against `exportsByFile`). `contentByFile` is
 * the already-read source of each project-relative file, reused so a file is not
 * read twice.
 */
export async function buildEdges(
  projectRoot: string,
  files: string[],
  contentByFile: Map<string, string>,
  exportsByFile: Map<string, Set<string>>,
): Promise<BuildEdgesResult> {
  const importEdges = await scanImports({ projectRoot, files, aliases: DEFAULT_ALIASES });

  const referenceEdges: CodeKnowledgeReferenceEdge[] = [];
  const importedNamesByFile = new Map<string, Set<string>>();

  // `scanImports` already dedupes (from, to) file edges, and `imported` is a Set, so
  // each (from, to, name) triple is produced at most once — no extra dedup needed.
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
