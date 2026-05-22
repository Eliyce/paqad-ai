import type { Pattern, PatternMatch, PatternFilter } from './types.js';
import type { PatternStore } from './pattern-store.js';

const STALENESS_THRESHOLD_DAYS = 180;
const STALE_SCORE_PENALTY = 0.15;
export type PatternSemanticScorer = (
  pattern: Pattern,
  keywords: string[],
) => Promise<number> | number;

export class PatternSuggester {
  constructor(
    private readonly store: PatternStore,
    private readonly relevanceThreshold = 0.3,
    private readonly semanticScorer?: PatternSemanticScorer,
  ) {}

  async suggest(
    keywords: string[],
    domain: string,
    frameworks: string[],
    limit = 3,
  ): Promise<PatternMatch[]> {
    const filter: PatternFilter = { domain, frameworks };
    const patterns = await this.store.list(filter);
    const semanticScores = await Promise.all(
      patterns.map(async (pattern) => ({
        id: pattern.id,
        score: this.semanticScorer ? await this.semanticScorer(pattern, keywords) : 0,
      })),
    );
    const semanticScoreMap = new Map(semanticScores.map((entry) => [entry.id, entry.score]));

    const scored = patterns
      .map((p) => ({
        pattern: p,
        is_stale: this.isStale(p),
        score: this.score(
          p,
          keywords,
          frameworks,
          semanticScoreMap.get(p.id) ?? 0,
          this.isStale(p),
        ),
      }))
      .filter(({ score }) => score >= this.relevanceThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  private score(
    pattern: Pattern,
    keywords: string[],
    frameworks: string[],
    semanticScore: number,
    isStale: boolean,
  ): number {
    let score = 0;

    // Framework match
    const frameworkMatch = frameworks.filter((f) =>
      pattern.stack_filter.frameworks.includes(f),
    ).length;
    if (frameworks.length > 0) {
      score += (frameworkMatch / frameworks.length) * 0.25;
    }

    // Keyword match against problem + tags
    if (keywords.length > 0) {
      const text = `${pattern.problem} ${pattern.tags.join(' ')}`.toLowerCase();
      const matches = keywords.filter((kw) => text.includes(kw.toLowerCase())).length;
      score += (matches / keywords.length) * 0.35;
    }

    return score + semanticScore * 0.4 - (isStale ? STALE_SCORE_PENALTY : 0);
  }

  private isStale(pattern: Pattern): boolean {
    const ageMs = Date.now() - new Date(pattern.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > STALENESS_THRESHOLD_DAYS;
  }
}
