// The one canonical cosine-similarity helper (RULE-13 RL-3210).
//
// Three byte-near-identical private copies existed before this — src/graph/similarity.ts,
// src/rag/vector-index.ts, and src/patterns/pattern-rag.ts — each re-deriving the same
// dot-over-norms formula. Two ways to compute the same thing is the bug the rule forbids,
// so every caller now routes through this single exported function.
//
// Contract preserved verbatim from the copies it replaces: a length mismatch, an empty
// vector, or a zero-norm input returns 0 (never NaN), so a caller can treat 0 as "no
// meaningful similarity" without guarding those cases itself.

/**
 * Cosine similarity of two equal-length numeric vectors, in [0, 1] for the non-negative
 * embedding vectors paqad works with (mathematically [-1, 1] in general). Returns 0 when
 * the lengths differ, either vector is empty, or either has zero magnitude.
 */
export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! * left[index]!;
    rightNorm += right[index]! * right[index]!;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
