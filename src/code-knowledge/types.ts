export const CODE_KNOWLEDGE_SCHEMA_VERSION = 1;

export type SymbolKind = 'function' | 'class' | 'component' | 'const' | 'type';

export type ExtractionTier = 'regex' | 'ast';

export interface CodeKnowledgeSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  signature: string;
  exported: boolean;
  module_slug: string | null;
  extraction_tier: ExtractionTier;
  caller_count: number;
  orphan: boolean;
}

export interface CodeKnowledgeFile {
  path: string;
  caller_count: number;
  orphan: boolean;
  entry_point: boolean;
}

export interface CodeKnowledgeImportEdge {
  from: string;
  to: string;
}

export interface CodeKnowledgeReferenceEdge {
  from: string;
  to: string;
  symbol: string;
}

export interface CodeKnowledgeDependency {
  name: string;
  ecosystem: string;
  imported: boolean;
}

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
