import type { AppFreshness, AppMap } from '@/core/types/site-map.js';

import { buildStatusOf, collectMapEvidence, type EvidenceResolution } from './verification.js';

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

function sameFreshness(a: AppFreshness | undefined, b: AppFreshness): boolean {
  return (
    a !== undefined &&
    a.anchors_total === b.anchors_total &&
    a.anchors_resolved === b.anchors_resolved &&
    a.anchors_broken === b.anchors_broken
  );
}

export interface StampedFreshness {
  map: AppMap;
  changed: boolean;
}

export function stampMapFreshness(map: AppMap, freshness: AppFreshness): StampedFreshness {
  if (sameFreshness(map.app.freshness, freshness)) return { map, changed: false };
  return { map: { ...map, app: { ...map.app, freshness } }, changed: true };
}

export function isStale(freshness: AppFreshness): boolean {
  return freshness.anchors_broken > 0;
}
