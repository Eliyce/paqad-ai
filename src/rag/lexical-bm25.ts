const K1 = 1.5;
const B = 0.75;

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
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
    return Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5));
  }

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
