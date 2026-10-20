import { scanWorkingTree } from '@/core/fs/gitignore-scan.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { readGitState } from '@/rag/git-state.js';

import {
  buildCodeKnowledgeIndex,
  readSourceFiles,
  SOURCE_GLOBS,
  type BuildOptions,
} from './builder.js';
import { computeDependencyUsage } from './dependency-usage.js';
import { resolveEntryPoints } from './entry-points.js';
import { buildEdges } from './import-edges.js';
import { loadModuleSlugResolver } from './module-slugs.js';
import { computeReachability, symbolKey } from './reachability.js';
import { readCodeKnowledgeIndex, writeCodeKnowledgeIndex } from './store.js';
import { extractSymbols } from './symbol-extractor.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from './types.js';
import type { CodeKnowledgeIndex, CodeKnowledgeSymbol } from './types.js';

const SOURCE_EXTENSION_RE = /\.(?:tsx?|jsx?|mjs|cjs|php|dart)$/;

export type RefreshReason = 'no-index' | 'full-rebuild' | 'incremental' | 'up-to-date';

export interface RefreshOptions extends BuildOptions {
  changedFiles?: string[];
}

export interface RefreshResult {
  refreshed: boolean;
  reason: RefreshReason;
  reparsed: string[];
  path?: string;
}

function gitChanged(
  git: { branch?: string | null; head_commit?: string | null },
  header: CodeKnowledgeIndex['header'],
): boolean {
  return (git.branch ?? null) !== header.branch || (git.head_commit ?? null) !== header.head_commit;
}

export async function refreshCodeKnowledgeIndex(
  projectRoot: string,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const existing = readCodeKnowledgeIndex(projectRoot);
  if (existing === null) {
    return { refreshed: false, reason: 'no-index', reparsed: [] };
  }

  const now = options.now ?? (() => new Date().toISOString());
  const git = options.gitState ?? readGitState(projectRoot);

  if (gitChanged(git, existing.header)) {
    const rebuilt = await buildCodeKnowledgeIndex(projectRoot, { now, gitState: git });
    const path = writeCodeKnowledgeIndex(projectRoot, rebuilt);
    return {
      refreshed: true,
      reason: 'full-rebuild',
      reparsed: rebuilt.files.map((file) => file.path),
      path,
    };
  }

  const requested = options.changedFiles ?? (await loadChangeEvidence(projectRoot)).files;
  const changed = requested.filter((file) => SOURCE_EXTENSION_RE.test(file));
  if (changed.length === 0) {
    return { refreshed: false, reason: 'up-to-date', reparsed: [] };
  }

  const merged = await incrementalIndex(projectRoot, existing, changed, now, git);
  const path = writeCodeKnowledgeIndex(projectRoot, merged);
  return { refreshed: true, reason: 'incremental', reparsed: changed, path };
}

async function incrementalIndex(
  projectRoot: string,
  existing: CodeKnowledgeIndex,
  changed: string[],
  now: () => string,
  git: { branch?: string | null; head_commit?: string | null },
): Promise<CodeKnowledgeIndex> {
  const changedSet = new Set(changed);
  const currentFiles = new Set(scanWorkingTree(projectRoot, SOURCE_GLOBS));
  const entryPoints = resolveEntryPoints(projectRoot);
  const resolver = loadModuleSlugResolver(projectRoot);

  const exportsByFile = new Map<string, Set<string>>();
  for (const symbol of existing.symbols) {
    if (changedSet.has(symbol.file)) continue;
    const set = exportsByFile.get(symbol.file) ?? new Set<string>();
    set.add(symbol.name);
    exportsByFile.set(symbol.file, set);
  }

  const contentByFile = await readSourceFiles(
    projectRoot,
    changed.filter((file) => currentFiles.has(file)),
  );
  const newSymbols: CodeKnowledgeSymbol[] = [];
  for (const [file, content] of contentByFile) {
    const names = new Set<string>();
    const extracted = extractSymbols(file, content);
    for (const symbol of extracted) {
      names.add(symbol.name);
      newSymbols.push({
        name: symbol.name,
        kind: symbol.kind,
        file,
        line: symbol.line,
        signature: symbol.signature,
        exported: symbol.exported,
        module_slug: resolver.slugForFile(file),
        extraction_tier: symbol.extraction_tier,
        caller_count: 0,
        orphan: false,
      });
    }
    if (names.size > 0) exportsByFile.set(file, names);
  }

  const fresh = await buildEdges(
    projectRoot,
    [...contentByFile.keys()],
    contentByFile,
    exportsByFile,
  );
  const keepImport = existing.import_edges.filter(
    (edge) =>
      !changedSet.has(edge.from) && currentFiles.has(edge.from) && currentFiles.has(edge.to),
  );
  const keepReference = existing.reference_edges.filter(
    (edge) =>
      !changedSet.has(edge.from) && currentFiles.has(edge.from) && currentFiles.has(edge.to),
  );
  const importEdges = [...keepImport, ...fresh.importEdges.filter((e) => currentFiles.has(e.to))];
  const referenceEdges = [
    ...keepReference,
    ...fresh.referenceEdges.filter((e) => currentFiles.has(e.to)),
  ];

  const keptSymbols = existing.symbols.filter(
    (symbol) => !changedSet.has(symbol.file) && currentFiles.has(symbol.file),
  );
  const symbolsMinusCounts = [...keptSymbols, ...newSymbols];

  const reach = computeReachability({
    files: [...currentFiles],
    importEdges,
    referenceEdges,
    entryFiles: entryPoints.files,
  });
  const symbols = symbolsMinusCounts.map((symbol) => {
    const callerCount = reach.symbolCallerCount.get(symbolKey(symbol.file, symbol.name)) ?? 0;
    return {
      ...symbol,
      caller_count: callerCount,
      orphan: callerCount === 0 && !entryPoints.files.has(symbol.file),
    };
  });

  const dependencies =
    existing.dependencies.length > 0
      ? existing.dependencies
      : await computeDependencyUsage(projectRoot, [...currentFiles], contentByFile);

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
