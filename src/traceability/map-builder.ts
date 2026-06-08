// Issue #109 — the two-way map builder. Pure: it joins already-gathered inputs
// (promises, inferred delivery, proofs, import edges, the code universe) into a
// single forward + backward map and the two flags. No I/O, no labels — only
// reality (the edges and the promise anchors) decides.

import type {
  BackwardLink,
  BuildTraceabilityMapInput,
  CodeRole,
  ForwardLink,
  PromiseRef,
  TraceabilityFinding,
  TraceabilityMap,
} from '@/core/types/traceability.js';
import { TRACEABILITY_MAP_SCHEMA_VERSION } from '@/core/types/traceability.js';

import { solveReachability } from './reachability.js';

function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(key(row), row);
  return map;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Build the promise → code → check (forward) and code → promise/user (backward)
 * map, plus the untested-promise and orphan-code findings.
 *
 * Delivery (promise → code) is inferred from the change set / module map and
 * sharpened by optional explicit markers (open decision #2, recommended).
 * Orphan code is decided by reachability (open decision #1: file-level).
 */
export function buildTraceabilityMap(input: BuildTraceabilityMapInput): TraceabilityMap {
  const mode: 'full' | 'light' = input.lane === 'fast' ? 'light' : 'full';
  const universe = uniqueSorted(input.codeUniverse);
  const universeSet = new Set(universe);

  // promise → delivering files (inferred + marker-sharpened).
  const deliveryByPromise = new Map<string, Set<string>>();
  const ensurePromise = (id: string): Set<string> => {
    const existing = deliveryByPromise.get(id);
    if (existing) return existing;
    const fresh = new Set<string>();
    deliveryByPromise.set(id, fresh);
    return fresh;
  };
  for (const entry of input.delivery) {
    const bucket = ensurePromise(entry.promise_id);
    for (const file of entry.files) bucket.add(file);
  }
  // Markers are code → promise; fold them in so an explicit marker counts as
  // delivery for that promise (and contributes the file to the anchor set).
  for (const marker of input.markers ?? []) {
    for (const id of marker.promise_ids) ensurePromise(id).add(marker.file);
  }

  // promise → proving checks.
  const proofsByPromise = new Map<string, Set<string>>();
  for (const entry of input.proofs) {
    const bucket = proofsByPromise.get(entry.promise_id) ?? new Set<string>();
    for (const check of entry.checks) bucket.add(check);
    proofsByPromise.set(entry.promise_id, bucket);
  }

  const promiseById = indexBy<PromiseRef>(input.promises, (p) => p.promise_id);

  // ── Forward map + untested-promise flag ────────────────────────────────
  const forward: ForwardLink[] = [];
  const findings: TraceabilityFinding[] = [];
  for (const promise of input.promises) {
    const delivering = uniqueSorted(deliveryByPromise.get(promise.promise_id) ?? []);
    const checks = uniqueSorted(proofsByPromise.get(promise.promise_id) ?? []);
    const proven = checks.length > 0;
    forward.push({
      promise_id: promise.promise_id,
      source: promise.source,
      description: promise.description,
      delivering_code: delivering,
      proving_checks: checks,
      proven,
    });
    if (!proven) {
      findings.push({
        code: 'TR-UNTESTED-PROMISE',
        promise_id: promise.promise_id,
        paths: delivering,
        detail: `Promise "${promise.promise_id}" has no proving check — we said we'd do this and nothing tests it.`,
      });
    }
  }

  // ── Anchors: code files that deliver a known promise ────────────────────
  // Only files inside the universe can anchor — delivery may name files outside
  // the in-scope tree (e.g. earlier slices); those still count for the forward
  // link but reachability runs over the universe.
  const anchorFiles = new Set<string>();
  const promiseIdsByFile = new Map<string, Set<string>>();
  for (const [promiseId, files] of deliveryByPromise) {
    if (!promiseById.has(promiseId)) continue;
    for (const file of files) {
      if (!universeSet.has(file)) continue;
      anchorFiles.add(file);
      const ids = promiseIdsByFile.get(file) ?? new Set<string>();
      ids.add(promiseId);
      promiseIdsByFile.set(file, ids);
    }
  }

  // When no promise anchors are known, orphan code cannot be distinguished from
  // shared groundwork — suppress the orphan flag rather than flag the whole
  // tree. Honest about why (settled decision: reality decides; don't fabricate).
  const anchorsKnown = anchorFiles.size > 0;
  const blockedReason = anchorsKnown
    ? null
    : input.promises.length === 0
      ? 'no_promises_discovered'
      : 'no_delivering_code_resolved';

  const { used, orphans, reachedFrom } = solveReachability({
    edges: input.edges,
    anchors: [...anchorFiles],
    universe,
  });

  // In the fast lane the orphan check is scoped to the change set — the cheap
  // "did this trivial change add code with no promise/no user?" subset.
  const changedSet = mode === 'light' ? new Set(input.changedFiles ?? []) : null;
  const inOrphanScope = (file: string): boolean =>
    changedSet === null ? true : changedSet.has(file);

  // ── Backward map + orphan-code flag ─────────────────────────────────────
  const backward: BackwardLink[] = [];
  let deliversCount = 0;
  let sharedCount = 0;
  let orphanCount = 0;
  const orphanSet = new Set(orphans);
  for (const file of universe) {
    const promiseIds = uniqueSorted(promiseIdsByFile.get(file) ?? []);
    const isAnchor = anchorFiles.has(file);
    const isUsed = used.has(file);
    let role: CodeRole;
    if (isAnchor) {
      role = 'delivers-promise';
      deliversCount++;
    } else if (isUsed) {
      role = 'shared-groundwork';
      sharedCount++;
    } else {
      role = 'orphan';
    }
    backward.push({
      file,
      promise_ids: promiseIds,
      used_by_promise: isUsed && !isAnchor,
      reached_from: reachedFrom.get(file) ?? [],
      role,
    });

    if (role === 'orphan' && anchorsKnown && orphanSet.has(file) && inOrphanScope(file)) {
      orphanCount++;
      findings.push({
        code: 'TR-CODE-ORPHAN',
        promise_id: null,
        paths: [file],
        detail: `Code "${file}" answers to no promise and nothing-with-a-promise uses it — exists, nothing asked for it, nothing uses it.`,
      });
    }
  }

  return {
    schema_version: TRACEABILITY_MAP_SCHEMA_VERSION,
    generated_at: input.now(),
    lane: input.lane,
    mode,
    anchors_known: anchorsKnown,
    blocked_reason: blockedReason,
    forward,
    backward,
    findings,
    counts: {
      promises: input.promises.length,
      untested_promises: findings.filter((f) => f.code === 'TR-UNTESTED-PROMISE').length,
      delivers_promise: deliversCount,
      shared_groundwork: sharedCount,
      orphan_code: orphanCount,
    },
  };
}
