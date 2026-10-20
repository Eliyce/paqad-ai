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
