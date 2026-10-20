import type { Evidence } from '@/core/types/site-map.js';

import { deriveMapFreshness, stampMapFreshness } from './freshness.js';
import { readCanonicalSiteMap, writeCanonicalSiteMap } from './store.js';
import { stampHonestTrustTiers } from './trust.js';
import { collectMapEvidence, type EvidenceResolution } from './verification.js';

export type ResolveEvidence = (pointers: Evidence[]) => EvidenceResolution[];

export type RestampCanonicalTrustResult =
  { status: 'no-map' } | { status: 'unchanged' } | { status: 'stamped'; path: string };

export function restampCanonicalTrust(
  projectRoot: string,
  resolveEvidence: ResolveEvidence,
): RestampCanonicalTrustResult {
  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) return { status: 'no-map' };

  const resolutions = resolveEvidence(collectMapEvidence(map));
  const { map: trustStamped, changed: trustChanged } = stampHonestTrustTiers(map, resolutions);
  const { map: stamped, changed: freshnessChanged } = stampMapFreshness(
    trustStamped,
    deriveMapFreshness(map, resolutions),
  );
  if (!trustChanged && !freshnessChanged) return { status: 'unchanged' };

  const path = writeCanonicalSiteMap(projectRoot, stamped);
  return { status: 'stamped', path };
}
