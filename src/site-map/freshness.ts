// Deterministic map-vs-code staleness (issue #466, Part G, FRESH-1 — the sibling of the trust
// proof in `./trust.ts`). The map is the source of truth for what the product does (docs-first),
// but it is perishable: when the code a cited `file:line` points at moves, that anchor stops
// resolving and the map is stale by exactly that many anchors. This module turns the map plus the
// gatherer's evidence resolutions — the SAME resolutions the trust stamp already gathers — into a
// small counts-only freshness verdict:
//
//   deriveMapFreshness(...)  — count the distinct cited anchors and how many still resolve.
//   stampMapFreshness(...)   — the WRITE side: record that verdict in `map.app.freshness` so the
//                              dashboard reads freshness statically, with no resolution at view
//                              time (NFR-4). Reports whether anything changed so a caller can skip a
//                              no-op write; counts-only (never a timestamp) so an unchanged map over
//                              unchanged code re-stamps to identical bytes.
//   isStale(...)             — a map is stale exactly when at least one cited anchor is broken.
//
// Pure over its inputs: the only I/O — resolving each `file:line` against the tree — is the
// gatherer's, exactly as `./trust.ts` and `./verification.ts` consume it.

import type { AppFreshness, AppMap } from '@/core/types/site-map.js';

import { buildStatusOf, collectMapEvidence, type EvidenceResolution } from './verification.js';

/**
 * The map's deterministic freshness against the code it cites. Counts the distinct evidence anchors
 * the map declares (via the same deduped `collectMapEvidence` the trust proof and the run engine
 * use) and how many still resolve, so `anchors_broken` is how far the map has drifted from code.
 * An anchor the gatherer did not resolve reads as resolved (the cautious default `buildStatusOf`
 * applies), so a missing resolution never inflates staleness.
 */
export function deriveMapFreshness(map: AppMap, resolutions: EvidenceResolution[]): AppFreshness {
  const anchors = collectMapEvidence(map);
  const statusOf = buildStatusOf(resolutions);
  const anchors_total = anchors.length;
  const anchors_broken = anchors.filter((anchor) => statusOf(anchor) !== 'resolved').length;
  return {
    anchors_total,
    anchors_resolved: anchors_total - anchors_broken,
    anchors_broken,
  };
}

/** Whether two freshness verdicts are identical (all three counts equal). */
function sameFreshness(a: AppFreshness | undefined, b: AppFreshness): boolean {
  return (
    a !== undefined &&
    a.anchors_total === b.anchors_total &&
    a.anchors_resolved === b.anchors_resolved &&
    a.anchors_broken === b.anchors_broken
  );
}

/** The stored map with its freshness stamped in, and whether the stamped value changed. */
export interface StampedFreshness {
  map: AppMap;
  changed: boolean;
}

/**
 * The WRITE side of the freshness proof: return a copy of the map whose `app.freshness` carries the
 * given verdict. Returns the same reference untouched when the stored value already matches, so a
 * caller can report an honest no-op and leave a steady map byte-for-byte unchanged.
 */
export function stampMapFreshness(map: AppMap, freshness: AppFreshness): StampedFreshness {
  if (sameFreshness(map.app.freshness, freshness)) return { map, changed: false };
  return { map: { ...map, app: { ...map.app, freshness } }, changed: true };
}

/**
 * Whether the map is stale against code — true exactly when at least one cited anchor no longer
 * resolves. The dashboard reads this from the stored `app.freshness`, so no resolution happens at
 * view time (NFR-4).
 */
export function isStale(freshness: AppFreshness): boolean {
  return freshness.anchors_broken > 0;
}
