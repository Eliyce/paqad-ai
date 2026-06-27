/**
 * Apply a reranker's output order back onto the retrieval hits (RAG buildout F18).
 *
 * The reranker returns a reordered list of chunk ids for the candidate pool it scored.
 * This reattaches that order to the original hit objects (which carry the cosine score
 * the precision floor and the match annotation depend on), so reranking only changes
 * ORDER — never the scores, the floor decision, or the injected token cap. Any hit the
 * reranker did not score (beyond its candidate pool) is appended in its original
 * relative order, so nothing is silently dropped.
 */
export function reorderByRankedIds<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  rankedIds: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [idOf(item), item]));
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const id of rankedIds) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(idOf(item))) {
      ordered.push(item);
    }
  }
  return ordered;
}
