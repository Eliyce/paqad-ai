// Incremental refresh for the code-knowledge index (issue #353). Keeps a persisted
// index current without the full-build cost: re-parse ONLY the changed files, splice
// them into the existing symbol/edge sets, and recompute the (cheap) reachability
// counting. A branch or head-commit change instead forces a full rebuild
// (decision D-01KXD2PZNQABK79T00QEG4D6BX). The initial build stays explicit
// (`index build`); with no existing index this is a no-op, mirroring the RAG
// background sync.
//
// Honest limits of the incremental path (the full rebuild is authoritative):
//  - dependency usage is carried over unchanged (deps change rarely; a branch
//    switch or explicit build refreshes it);
//  - a reference edge FROM an unchanged file INTO a changed file keeps its prior
//    resolution, so a renamed/removed export is only reconciled on the next full
//    build. Both are documented so a consumer never over-trusts a stale count.

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
  /** Project-relative changed files; when omitted, derived from the change evidence (git status). */
  changedFiles?: string[];
}

export interface RefreshResult {
  refreshed: boolean;
  reason: RefreshReason;
  /** Files re-parsed this run (all files on a full rebuild). */
  reparsed: string[];
  path?: string;
}

function gitChanged(
  git: { branch?: string | null; head_commit?: string | null },
  header: CodeKnowledgeIndex['header'],
): boolean {
  return (git.branch ?? null) !== header.branch || (git.head_commit ?? null) !== header.head_commit;
}

/**
 * Refresh the persisted index. Returns what it did so a caller (and AC-5) can see
 * whether it rebuilt, incrementally re-parsed a specific file set, or skipped.
 */
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

/** Splice re-parsed changed files into the existing index without re-reading the rest. */
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

  // Reconstruct the exported-name set for EVERY file: from the existing index for
  // unchanged files (no re-read), from a fresh parse for changed ones.
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

  // Fresh edges for the changed files; keep every other file's edges from the index,
  // dropping any whose endpoints no longer exist.
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

  // Dependency usage refreshes on a full rebuild; carry it over here. When the
  // existing index has none recorded, recompute once so a first incremental after a
  // manual index edit is not left empty.
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
