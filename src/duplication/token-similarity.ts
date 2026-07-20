// Token-shingle similarity — the no-embedding fallback (issue #358, FR-6 / AC-6).
//
// The duplication detector prefers the embedding index (cosine over vectors). But a RAG-off
// project has no `.paqad/vectors/index.json`, and the gate must still function there. This is
// that fallback: a normalized k-shingle Jaccard over the raw chunk text, costing zero model
// tokens and no index.
//
// A private, DecisionPacket-coupled `jaccard` exists at src/planning/decision-precedents.ts and
// the repo has six separate private `tokenize` copies, none reusable as a general code
// tokenizer; so this module owns its own small, code-aware normalizer rather than bending one
// of those to a second purpose.

const DEFAULT_SHINGLE_SIZE = 4;

/** Joins tokens into a shingle. A newline can never appear inside a single token, so
 *  `['a','bc']` and `['ab','c']` never collapse to the same shingle string. */
const SHINGLE_SEP = '\n';

/**
 * Tokenize a source snippet into a normalized identifier/operator stream. Comments and string
 * literals are dropped and all whitespace is collapsed, so two blocks that differ only in
 * formatting, comments, or literal contents still shingle alike — which is exactly the
 * copy-paste-with-light-edits pattern the gate targets. Deterministic and pure.
 */
export function tokenizeCode(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ');
  const withoutStrings = withoutComments
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
  const tokens = withoutStrings.match(/[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|[^\sA-Za-z0-9_$]/g);
  return tokens ? tokens.map((token) => token.toLowerCase()) : [];
}

/**
 * The set of overlapping k-token shingles of a token stream. When the stream is shorter than
 * `size`, its single shingle is the whole stream, so short snippets still compare rather than
 * silently scoring 0.
 */
export function shingles(tokens: string[], size: number = DEFAULT_SHINGLE_SIZE): Set<string> {
  const result = new Set<string>();
  if (tokens.length === 0) {
    return result;
  }
  if (tokens.length < size) {
    result.add(tokens.join(SHINGLE_SEP));
    return result;
  }
  for (let index = 0; index + size <= tokens.length; index += 1) {
    result.add(tokens.slice(index, index + size).join(SHINGLE_SEP));
  }
  return result;
}

/** Jaccard overlap of two shingle sets: |A ∩ B| / |A ∪ B|. Two empty sets score 0. */
export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const shingle of left) {
    if (right.has(shingle)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Normalized k-shingle Jaccard similarity of two code snippets, in [0, 1]. The stand-in for
 * cosine when no embedding vectors are available (FR-6). Pure and deterministic.
 */
export function tokenShingleSimilarity(
  left: string,
  right: string,
  size: number = DEFAULT_SHINGLE_SIZE,
): number {
  return jaccard(shingles(tokenizeCode(left), size), shingles(tokenizeCode(right), size));
}
