// Code-knowledge index types (issue #353). The deterministic, offline record of
// every exported symbol and the imports between files, persisted to
// `.paqad/indexes/code-knowledge.json`. Built once, consumed twice (later issues):
// dead-code findings read it backwards; reuse answers read it forwards.

/** Bumped when the persisted shape changes; the store rejects a mismatched file. */
export const CODE_KNOWLEDGE_SCHEMA_VERSION = 1;

export type SymbolKind = 'function' | 'class' | 'component' | 'const' | 'type';

/**
 * How a symbol's details were derived. `regex` is the v1 default (line + signature
 * from a regex pass); `ast` is seamed for a later tree-sitter upgrade so a consumer
 * can weight confidence without the index shape changing.
 */
export type ExtractionTier = 'regex' | 'ast';

export interface CodeKnowledgeSymbol {
  /** Exported identifier, e.g. `buildProjectRepoMap`. */
  name: string;
  kind: SymbolKind;
  /** Project-relative, forward-slash path of the defining file. */
  file: string;
  /** 1-based line of the export. */
  line: number;
  /** Params + return as text where the parser gives it; the name is the fallback. */
  signature: string;
  exported: boolean;
  /** Owning module slug (from the module map), or null when no module claims the file. */
  module_slug: string | null;
  extraction_tier: ExtractionTier;
  /** Distinct non-test files that reference this symbol (in-edges). */
  caller_count: number;
  /** No in-edges AND the file is not on the entry-point allowlist. */
  orphan: boolean;
}

export interface CodeKnowledgeFile {
  /** Project-relative, forward-slash path. */
  path: string;
  /** Distinct non-test files that import this file (in-edges). */
  caller_count: number;
  /** No in-edges AND not on the entry-point allowlist. */
  orphan: boolean;
  /** On the entry-point allowlist (a package/bin entry, CLI, hook, test, convention). */
  entry_point: boolean;
}

/** A resolved file-to-file import edge (from `scanImports`). */
export interface CodeKnowledgeImportEdge {
  /** Importing file (project-relative, forward-slash). */
  from: string;
  /** Imported file (project-relative, forward-slash). */
  to: string;
}

/** A file-to-symbol reference resolved by import-name matching (no type resolution). */
export interface CodeKnowledgeReferenceEdge {
  /** Referencing file. */
  from: string;
  /** Defining file of the referenced symbol. */
  to: string;
  /** The referenced symbol name. */
  symbol: string;
}

/** A declared dependency and whether any file actually imports it. */
export interface CodeKnowledgeDependency {
  name: string;
  ecosystem: string;
  imported: boolean;
}

/**
 * Freshness contract, mirroring `.paqad/vectors/meta.json`. The entry-point glob
 * list rides here so a consumer can see exactly why a file was not flagged orphan.
 */
export interface CodeKnowledgeHeader {
  generated_at: string;
  branch: string | null;
  head_commit: string | null;
  schema_version: number;
  entry_point_globs: string[];
}

export interface CodeKnowledgeIndex {
  schema_version: number;
  header: CodeKnowledgeHeader;
  symbols: CodeKnowledgeSymbol[];
  files: CodeKnowledgeFile[];
  import_edges: CodeKnowledgeImportEdge[];
  reference_edges: CodeKnowledgeReferenceEdge[];
  dependencies: CodeKnowledgeDependency[];
}
