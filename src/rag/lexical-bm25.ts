/**
 * Lexical BM25 retrieval leg (RAG buildout F17).
 *
 * Dense (embedding) retrieval silently drops exact identifiers and symbols: a query
 * for `canAccessAuth` or `coupon_ledger` can rank the file that literally contains it
 * below semantically-fuzzy neighbours. BM25 is the classic lexical counter to that —
 * it rewards documents that contain the query's rare terms. F17 fuses this leg with
 * the dense leg (see `rrf-fusion.ts`) so exact-match content is not lost.
 *
 * This module is pure and deterministic (no I/O, no clock), so it is cheap to run in
 * the background worker and fully unit-testable.
 */

/** BM25 term-frequency saturation parameter (standard default). */
const K1 = 1.5;
/** BM25 length-normalisation parameter (standard default). */
const B = 0.75;

/**
 * Tokenise text for lexical matching. Splits on non-alphanumerics AND on camelCase /
 * snake_case / dotted boundaries, lowercased, so `canAccessAuth`, `can_access_auth`,
 * and `can access auth` all yield the same `['can','access','auth']` terms. This is
 * what lets a natural-language query match an identifier and vice versa.
 */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export interface Bm25Document {
  id: string;
  content: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

/**
 * An in-memory BM25 index over a document set. Build once per query batch from the
 * candidate chunks, then `search` with the query text. Documents with no overlapping
 * query term score 0 and are omitted from the ranking.
 */
export class Bm25Index {
  private readonly docTokens = new Map<string, string[]>();
  private readonly docFreq = new Map<string, number>();
  private readonly docLength = new Map<string, number>();
  private readonly avgDocLength: number;
  private readonly docCount: number;

  constructor(documents: readonly Bm25Document[]) {
    this.docCount = documents.length;
    let totalLength = 0;
    for (const doc of documents) {
      const tokens = tokenize(doc.content);
      this.docTokens.set(doc.id, tokens);
      this.docLength.set(doc.id, tokens.length);
      totalLength += tokens.length;
      for (const term of new Set(tokens)) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
    this.avgDocLength = this.docCount === 0 ? 0 : totalLength / this.docCount;
  }

  private idf(term: string): number {
    const n = this.docFreq.get(term) ?? 0;
    // BM25 idf with the +1 smoothing that keeps it non-negative for common terms.
    return Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5));
  }

  /**
   * Rank documents for `query` by BM25, descending. `topK` caps the result length;
   * documents with a zero score (no shared terms) are excluded.
   */
  search(query: string, topK?: number): Bm25Hit[] {
    const queryTerms = new Set(tokenize(query));
    if (queryTerms.size === 0 || this.docCount === 0) {
      return [];
    }

    const hits: Bm25Hit[] = [];
    for (const [id, tokens] of this.docTokens) {
      const length = this.docLength.get(id) ?? 0;
      let score = 0;
      for (const term of queryTerms) {
        const tf = countOccurrences(tokens, term);
        if (tf === 0) {
          continue;
        }
        const denom = tf + K1 * (1 - B + (B * length) / (this.avgDocLength || 1));
        score += this.idf(term) * ((tf * (K1 + 1)) / denom);
      }
      if (score > 0) {
        hits.push({ id, score });
      }
    }

    hits.sort((left, right) => right.score - left.score);
    return topK === undefined ? hits : hits.slice(0, topK);
  }
}

function countOccurrences(tokens: readonly string[], term: string): number {
  let count = 0;
  for (const token of tokens) {
    if (token === term) {
      count += 1;
    }
  }
  return count;
}
