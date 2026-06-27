/**
 * Reciprocal Rank Fusion (RAG buildout F17).
 *
 * Fuses several ranked lists into one without needing their scores to be on a common
 * scale — exactly the dense-vs-lexical situation, where cosine similarity and BM25
 * scores are not comparable. Each list contributes `1 / (k + rank)` to every id it
 * ranks; ids ranked highly by multiple lists rise to the top. `k` (default 60, the
 * value from the original RRF paper) damps the influence of very high ranks.
 */

/** Default rank-damping constant from the RRF paper. */
export const RRF_K = 60;

export interface RrfResult {
  id: string;
  score: number;
}

/**
 * Fuse `rankings` (each an ordered list of ids, best first) into one descending list.
 * Ids may appear in any subset of the rankings; an id missing from a ranking simply
 * gets no contribution from it. Ties break by first appearance for determinism.
 */
export function reciprocalRankFusion(
  rankings: ReadonlyArray<readonly string[]>,
  k: number = RRF_K,
): RrfResult[] {
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const id = ranking[rank];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!firstSeen.has(id)) {
        firstSeen.set(id, order++);
      }
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (firstSeen.get(left.id) ?? 0) - (firstSeen.get(right.id) ?? 0);
    });
}
