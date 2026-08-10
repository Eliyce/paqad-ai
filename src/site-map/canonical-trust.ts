// Write-path composition for the trust proof (issue #466, Part G). This is the one impure seam
// that makes the stored canonical map self-describe its earned trust: it reads the AI-authored
// `docs/site-map/app-map.yaml`, resolves every cited `file:line` against the tree (the gatherer's
// only I/O, injected so this is exercised offline), stamps each element's earned tier via the pure
// `stampHonestTrustTiers`, and writes the result back — but only when a tier actually changed, so a
// steady map is left byte-for-byte untouched. Running it at author/verify time means the dashboard
// renders earned tiers statically, with no resolution work at view time (NFR-4).
//
// It operates directly on the canonical location, independent of the run/retest orchestrator, which
// still reads the superseded `docs/instructions/site-map/` path until the migration commit (C8)
// moves it. The CLI wires the real gatherer's `resolveEvidence` in as the resolver.

import type { Evidence } from '@/core/types/site-map.js';

import { readCanonicalSiteMap, writeCanonicalSiteMap } from './store.js';
import { stampHonestTrustTiers } from './trust.js';
import { collectMapEvidence, type EvidenceResolution } from './verification.js';

/** How each cited `file:line` resolves against the tree — the same seam Tier-A verification uses. */
export type ResolveEvidence = (pointers: Evidence[]) => EvidenceResolution[];

/**
 * The outcome of a re-stamp, as a discriminated union so a caller (and its narration) reports
 * exactly what happened:
 *  - `no-map`    — no canonical map is authored yet, so there is nothing to stamp.
 *  - `unchanged` — the map already carries its earned tiers; nothing was written.
 *  - `stamped`   — one or more tiers were re-earned and the map was rewritten; `path` is the file.
 */
export type RestampCanonicalTrustResult =
  { status: 'no-map' } | { status: 'unchanged' } | { status: 'stamped'; path: string };

/**
 * Re-stamp the canonical map's trust tiers from live code evidence and persist the result when it
 * changed. Pure over its injected `resolveEvidence`, so tests drive the whole path offline; the
 * only real I/O is the store read and the conditional atomic write.
 */
export function restampCanonicalTrust(
  projectRoot: string,
  resolveEvidence: ResolveEvidence,
): RestampCanonicalTrustResult {
  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) return { status: 'no-map' };

  const resolutions = resolveEvidence(collectMapEvidence(map));
  const { map: stamped, changed } = stampHonestTrustTiers(map, resolutions);
  if (!changed) return { status: 'unchanged' };

  const path = writeCanonicalSiteMap(projectRoot, stamped);
  return { status: 'stamped', path };
}
