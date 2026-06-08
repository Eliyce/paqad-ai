// Issue #109 — reachability solver over the import graph.
//
// The anti-gaming heart of the traceability map. A code file is legitimate iff
// it either delivers a promise itself (an "anchor") OR is reachable from an
// anchor by following import edges — i.e. something-with-a-promise actually USES
// it. A file reached only from other unreachable files (a dead cluster that
// imports itself) is NOT used by any promise and is flagged. Reachability is
// computed from real edges, never from a "this is fine" label, so a comment can
// never suppress a truly-dead flag.
//
// File-level granularity (open decision #1, recommended): cheap, reuses the
// existing import-scanner edges. Symbol/export-level dead-code is a follow-up
// where a per-language analyzer exists.

export interface ReachabilityInput {
  /** `from` imports `to`; both project-relative, forward-slashed. */
  edges: Array<{ from: string; to: string }>;
  /** Files that deliver at least one promise — the roots of "is this used?". */
  anchors: string[];
  /** All code files under consideration for the orphan check. */
  universe: string[];
}

export interface ReachabilityResult {
  /** Anchors plus every file transitively imported by an anchor. */
  used: Set<string>;
  /** universe \ used — code that answers to no promise and that nothing-with-a
   *  -promise uses. */
  orphans: string[];
  /** For each used non-anchor file, a few anchor/used files that import it. */
  reachedFrom: Map<string, string[]>;
}

const REACHED_FROM_SAMPLE = 3;

/**
 * Forward closure from the anchor set over import edges. `from` imports `to`,
 * so when an anchor (or an already-used file) imports X, X is used. We also
 * record a small sample of importers per used file as evidence of use.
 */
export function solveReachability(input: ReachabilityInput): ReachabilityResult {
  // Adjacency: file -> files it imports. Reverse: file -> files that import it
  // (used only for the evidence sample on each used file).
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
