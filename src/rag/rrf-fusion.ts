export const RRF_K = 60;

export interface RrfResult {
  id: string;
  score: number;
}

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
