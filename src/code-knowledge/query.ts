// Querying the code-knowledge index (issue #353). Given a name or a file path,
// return a card a developer (or a later consumer) can act on: for a symbol, its
// signature, file:line, caller count and top callers; for a file, its importers and
// the symbols it defines. Pure over an already-loaded index — no I/O here.

import type { CodeKnowledgeIndex } from './types.js';

export interface SymbolCard {
  kind: 'symbol';
  name: string;
  file: string;
  line: number;
  signature: string;
  module_slug: string | null;
  extraction_tier: string;
  caller_count: number;
  orphan: boolean;
  /** Distinct files that reference this symbol, most-relevant first (capped). */
  top_callers: string[];
}

export interface FileCard {
  kind: 'file';
  path: string;
  caller_count: number;
  orphan: boolean;
  entry_point: boolean;
  /** Distinct files that import this file (capped). */
  importers: string[];
  /** Symbols this file defines, with their own caller counts. */
  symbols: Array<{ name: string; caller_count: number }>;
}

export type QueryCard = SymbolCard | FileCard;

export interface QueryResult {
  term: string;
  matches: QueryCard[];
}

const TOP_CALLERS_LIMIT = 10;

function distinctSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function symbolCard(
  index: CodeKnowledgeIndex,
  symbol: CodeKnowledgeIndex['symbols'][number],
): SymbolCard {
  const callers = index.reference_edges
    .filter((edge) => edge.to === symbol.file && edge.symbol === symbol.name)
    .map((edge) => edge.from);
  return {
    kind: 'symbol',
    name: symbol.name,
    file: symbol.file,
    line: symbol.line,
    signature: symbol.signature,
    module_slug: symbol.module_slug,
    extraction_tier: symbol.extraction_tier,
    caller_count: symbol.caller_count,
    orphan: symbol.orphan,
    top_callers: distinctSorted(callers).slice(0, TOP_CALLERS_LIMIT),
  };
}

function fileCard(index: CodeKnowledgeIndex, file: CodeKnowledgeIndex['files'][number]): FileCard {
  const importers = index.import_edges
    .filter((edge) => edge.to === file.path)
    .map((edge) => edge.from);
  const symbols = index.symbols
    .filter((symbol) => symbol.file === file.path)
    .map((symbol) => ({ name: symbol.name, caller_count: symbol.caller_count }));
  return {
    kind: 'file',
    path: file.path,
    caller_count: file.caller_count,
    orphan: file.orphan,
    entry_point: file.entry_point,
    importers: distinctSorted(importers).slice(0, TOP_CALLERS_LIMIT),
    symbols,
  };
}

/**
 * Look up `term` as a symbol name (may match several definitions) and, failing that,
 * as a file path. Returns every matching card; an empty `matches` means not found.
 */
export function queryCodeKnowledge(index: CodeKnowledgeIndex, term: string): QueryResult {
  const symbolMatches = index.symbols
    .filter((symbol) => symbol.name === term)
    .map((symbol) => symbolCard(index, symbol));
  if (symbolMatches.length > 0) {
    return { term, matches: symbolMatches };
  }

  const fileMatch = index.files.find((file) => file.path === term);
  if (fileMatch) {
    return { term, matches: [fileCard(index, fileMatch)] };
  }

  return { term, matches: [] };
}
