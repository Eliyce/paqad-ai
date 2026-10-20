import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { scanWorkingTree } from '@/core/fs/gitignore-scan.js';
import { readGitState } from '@/rag/git-state.js';

import { computeDependencyUsage } from './dependency-usage.js';
import { resolveEntryPoints } from './entry-points.js';
import { buildEdges } from './import-edges.js';
import { loadModuleSlugResolver } from './module-slugs.js';
import { computeReachability, symbolKey } from './reachability.js';
import { extractSymbols } from './symbol-extractor.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from './types.js';
import type { CodeKnowledgeIndex, CodeKnowledgeSymbol } from './types.js';

export const SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,php,dart}'];

export interface BuildOptions {
  now?: () => string;
  gitState?: { branch?: string | null; head_commit?: string | null };
}

export async function readSourceFiles(
  projectRoot: string,
  files: string[],
): Promise<Map<string, string>> {
  const contentByFile = new Map<string, string>();
  for (const rel of files) {
    try {
      contentByFile.set(rel, await readFile(join(projectRoot, rel), 'utf8'));
    } catch {}
  }
  return contentByFile;
}

function extractAll(files: string[], contentByFile: Map<string, string>) {
  const rawSymbols: Array<{ file: string; symbol: ReturnType<typeof extractSymbols>[number] }> = [];
  const exportsByFile = new Map<string, Set<string>>();
  for (const file of files) {
    const content = contentByFile.get(file);
    /* v8 ignore next -- defensive twin of readSourceFiles' skip: only a glob-then-delete race */
    if (content === undefined) continue;
    const symbols = extractSymbols(file, content);
    if (symbols.length === 0) continue;
    const names = new Set<string>();
    for (const symbol of symbols) {
      rawSymbols.push({ file, symbol });
      names.add(symbol.name);
    }
    exportsByFile.set(file, names);
  }
  return { rawSymbols, exportsByFile };
}

export async function buildCodeKnowledgeIndex(
  projectRoot: string,
  options: BuildOptions = {},
): Promise<CodeKnowledgeIndex> {
  const now = options.now ?? (() => new Date().toISOString());
  const files = scanWorkingTree(projectRoot, SOURCE_GLOBS);
  const contentByFile = await readSourceFiles(projectRoot, files);

  const resolver = loadModuleSlugResolver(projectRoot);
  const entryPoints = resolveEntryPoints(projectRoot);
  const { rawSymbols, exportsByFile } = extractAll(files, contentByFile);

  const { importEdges, referenceEdges } = await buildEdges(
    projectRoot,
    files,
    contentByFile,
    exportsByFile,
  );
  const reach = computeReachability({
    files,
    importEdges,
    referenceEdges,
    entryFiles: entryPoints.files,
  });
  const dependencies = await computeDependencyUsage(projectRoot, files, contentByFile);

  const symbols: CodeKnowledgeSymbol[] = rawSymbols.map(({ file, symbol }) => {
    const callerCount = reach.symbolCallerCount.get(symbolKey(file, symbol.name)) ?? 0;
    return {
      name: symbol.name,
      kind: symbol.kind,
      file,
      line: symbol.line,
      signature: symbol.signature,
      exported: symbol.exported,
      module_slug: resolver.slugForFile(file),
      extraction_tier: symbol.extraction_tier,
      caller_count: callerCount,
      orphan: callerCount === 0 && !entryPoints.files.has(file),
    };
  });

  const git = options.gitState ?? readGitState(projectRoot);
  return {
    schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
    header: {
      generated_at: now(),
      branch: git.branch ?? null,
      head_commit: git.head_commit ?? null,
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      entry_point_globs: entryPoints.globs,
    },
    symbols,
    files: reach.files,
    import_edges: importEdges,
    reference_edges: referenceEdges,
    dependencies,
  };
}
