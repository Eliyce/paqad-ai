import { basename, dirname } from 'node:path';
import type { Chunk, FusionDiagnostic } from './types.js';
import { applyMetadataFilters } from './metadata-filter.js';
import type { MetadataFilter } from './metadata-filter.js';

export interface ScoringContext {
  keywords: string[];
  targetFilePath?: string;
  symbolReferences?: string[];
  sessionStartMs: number;
  vectorScores?: Map<string, number>;
}

export class RelevanceScorer {
  constructor(private readonly threshold = 0.15) {}

  score(chunk: Chunk, context: ScoringContext): number {
    const vector = this.vectorSimilarityScore(chunk, context.vectorScores);
    const kw = this.keywordOverlapScore(chunk, context.keywords);
    const sym = this.symbolReferenceScore(chunk, context.symbolReferences ?? []);
    const path = this.filePathProximityScore(chunk, context.targetFilePath ?? '');
    const depth = this.astDepthPenalty(chunk);

    return vector * 0.55 + kw * 0.25 + sym * 0.1 + path * 0.1 - depth * 0.05;
  }

  filterAndRank(
    chunks: Chunk[],
    context: ScoringContext,
    filters: MetadataFilter[] = [],
  ): { chunks: Chunk[]; fusion_strategy: FusionDiagnostic } {
    const filterResult = applyMetadataFilters(chunks, filters);
    const corpus = filterResult.chunks;

    const ranked = corpus
      .map((c) => ({ chunk: c, score: this.score(c, context) }))
      .filter(({ score }) => score >= this.threshold)
      .sort((a, b) => b.score - a.score)
      .map(({ chunk }) => chunk);

    const fusion_strategy: FusionDiagnostic = {
      signals: ['vector:0.55', 'keyword:0.25', 'symbol:0.10', 'path:0.10'],
      filters_applied: filterResult.filter_types_applied,
      filter_fallback: filterResult.fallback || undefined,
      filter_fallback_reason: filterResult.fallback_reason,
    };

    return { chunks: ranked, fusion_strategy };
  }

  private vectorSimilarityScore(chunk: Chunk, vectorScores?: Map<string, number>): number {
    if (!vectorScores) return 0;
    return vectorScores.get(chunk.id) ?? 0;
  }

  private keywordOverlapScore(chunk: Chunk, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const content = chunk.content.toLowerCase();
    const matched = keywords.filter((kw) => content.includes(kw.toLowerCase())).length;
    return matched / keywords.length;
  }

  private symbolReferenceScore(chunk: Chunk, symbols: string[]): number {
    if (symbols.length === 0) return 0;
    const content = chunk.content;
    const matched = symbols.filter((sym) => content.includes(sym)).length;
    return matched / symbols.length;
  }

  private filePathProximityScore(chunk: Chunk, targetPath: string): number {
    if (!targetPath) return 0;
    const chunkDir = dirname(chunk.source_file);
    const targetDir = dirname(targetPath);

    // Same directory = 1.0, same parent = 0.5, different = 0
    if (chunkDir === targetDir) return 1.0;
    if (dirname(chunkDir) === dirname(targetDir)) return 0.5;
    if (basename(chunkDir) === basename(targetDir)) return 0.3;
    return 0;
  }
  private astDepthPenalty(chunk: Chunk): number {
    // Deeper AST nodes get slight penalty
    const depth = (chunk.ast_node_path.match(/>/g) ?? []).length;
    return Math.min(depth * 0.2, 1.0);
  }
}
