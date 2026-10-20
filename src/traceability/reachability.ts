export interface ReachabilityInput {
  edges: Array<{ from: string; to: string }>;
  anchors: string[];
  universe: string[];
}

export interface ReachabilityResult {
  used: Set<string>;
  orphans: string[];
  reachedFrom: Map<string, string[]>;
}

const REACHED_FROM_SAMPLE = 3;

export function solveReachability(input: ReachabilityInput): ReachabilityResult {
  const importsOf = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const bucket = map.get(key);
    if (bucket) bucket.push(value);
    else map.set(key, [value]);
  };
  for (const { from, to } of input.edges) {
    push(importsOf, from, to);
    push(importedBy, to, from);
  }

  const used = new Set<string>();
  const queue: string[] = [];
  for (const anchor of input.anchors) {
    if (!used.has(anchor)) {
      used.add(anchor);
      queue.push(anchor);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of importsOf.get(current) ?? []) {
      if (!used.has(next)) {
        used.add(next);
        queue.push(next);
      }
    }
  }

  const anchorSet = new Set(input.anchors);
  const reachedFrom = new Map<string, string[]>();
  for (const file of used) {
    if (anchorSet.has(file)) continue;
    const importers = (importedBy.get(file) ?? []).filter((f) => used.has(f));
    reachedFrom.set(file, importers.slice(0, REACHED_FROM_SAMPLE));
  }

  const orphans = input.universe.filter((file) => !used.has(file)).sort();

  return { used, orphans, reachedFrom };
}
