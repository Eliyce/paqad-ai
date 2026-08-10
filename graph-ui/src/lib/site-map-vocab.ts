// The small, fixed visual vocabulary for the site map (issue #466, UXR-10). A person never has
// to guess what a shape means: every node kind maps to one of a handful of families, each with a
// plain-language name and a shape that reads without colour (A11Y-3). Trust tiers get an honest,
// non-colour label too, so a lower tier is never shown as a higher one (PROOF-15).

import type { AppMap, SiteMapFreshness, SurfaceKind, TrustTier } from './site-map-types';

export type NodeShape = 'rounded' | 'diamond' | 'stadium' | 'slanted';

export interface KindMeta {
  /** Plain-language family shown in the legend and detail panel. */
  family: string;
  /** Short tag drawn on the node so kind is legible at a glance, not colour-coded. */
  tag: string;
  shape: NodeShape;
}

const KIND_META: Record<SurfaceKind, KindMeta> = {
  page: { family: 'Screen', tag: 'PAGE', shape: 'rounded' },
  screen: { family: 'Screen', tag: 'SCREEN', shape: 'rounded' },
  modal: { family: 'Screen', tag: 'MODAL', shape: 'rounded' },
  action: { family: 'Action', tag: 'ACTION', shape: 'rounded' },
  api: { family: 'Action', tag: 'API', shape: 'rounded' },
  'cli-command': { family: 'Action', tag: 'CLI', shape: 'rounded' },
  job: { family: 'Action', tag: 'JOB', shape: 'rounded' },
  webhook: { family: 'Action', tag: 'HOOK', shape: 'rounded' },
  email: { family: 'Action', tag: 'EMAIL', shape: 'rounded' },
  'external-system': { family: 'External', tag: 'EXTERNAL', shape: 'slanted' },
  handoff: { family: 'External', tag: 'HANDOFF', shape: 'slanted' },
  subflow: { family: 'External', tag: 'SUBFLOW', shape: 'slanted' },
  'prompt-entry': { family: 'Flow', tag: 'ENTRY', shape: 'rounded' },
  'llm-workflow': { family: 'Flow', tag: 'FLOW', shape: 'rounded' },
  step: { family: 'Flow', tag: 'STEP', shape: 'rounded' },
  router: { family: 'Decision', tag: 'ROUTER', shape: 'diamond' },
  'decision-pause': { family: 'Decision', tag: 'DECISION', shape: 'diamond' },
  terminal: { family: 'End', tag: 'END', shape: 'stadium' },
};

export function kindMeta(kind: SurfaceKind): KindMeta {
  return KIND_META[kind] ?? { family: 'Screen', tag: kind.toUpperCase(), shape: 'rounded' };
}

/** The distinct families, in reading order, for the always-visible legend. */
export const KIND_LEGEND: { family: string; shape: NodeShape }[] = [
  { family: 'Screen', shape: 'rounded' },
  { family: 'Action', shape: 'rounded' },
  { family: 'Decision', shape: 'diamond' },
  { family: 'External', shape: 'slanted' },
  { family: 'End', shape: 'stadium' },
];

export interface TrustMeta {
  label: string;
  /** How honest to be about certainty; higher rank never shown for a lower one. */
  rank: number;
}

const TRUST_META: Record<TrustTier, TrustMeta> = {
  unverified: { label: 'Unverified', rank: 0 },
  inferred: { label: 'Inferred', rank: 1 },
  'proven-in-code': { label: 'Proven in code', rank: 2 },
  'proven-by-test': { label: 'Proven by test', rank: 3 },
  'human-confirmed': { label: 'Human confirmed', rank: 4 },
};

export function trustMeta(trust: TrustTier | undefined): TrustMeta {
  return trust ? TRUST_META[trust] : { label: 'Unverified', rank: 0 };
}

/** The tier at or above which a claim is backed by the code itself (proven-in-code and up). Below
 *  this a claim is still inferred or unverified, and the honesty summary counts it as unproven. */
export const PROVEN_RANK = 2;

/** A one-line, honest meaning for a trust tier, so the detail panel never leaves a person guessing
 *  what "Inferred" claims (PROOF-15). Phrasing follows the writing style: plain, no em dashes. */
const TRUST_MEANING: Record<TrustTier, string> = {
  unverified: 'Recorded, but not yet checked against the code.',
  inferred: 'Read from a convention, not traced to a specific line.',
  'proven-in-code': 'Traced to the cited line in the code.',
  'proven-by-test': 'Backed by a test that exercises it.',
  'human-confirmed': 'A person has confirmed this is correct.',
};

export function trustMeaning(trust: TrustTier | undefined): string {
  return trust ? TRUST_MEANING[trust] : TRUST_MEANING.unverified;
}

export type FreshnessTone = 'fresh' | 'stale' | 'unverified';

export interface FreshnessVerdict {
  tone: FreshnessTone;
  /** A glyph that reads without colour, so the verdict is not colour-only (A11Y-3). */
  glyph: string;
  label: string;
  detail: string;
}

/**
 * Turn the stored freshness counts into a plain-language verdict the viewer can trust at a glance
 * (FRESH-1). It only reads what the write path already stamped, so the dashboard resolves nothing
 * at view time (NFR-1). Before the map has ever been verified the counts are null, and the honest
 * answer is neither fresh nor stale but "not yet checked".
 */
export function freshnessVerdict(freshness: SiteMapFreshness): FreshnessVerdict {
  if (freshness.anchors_total === null) {
    return {
      tone: 'unverified',
      glyph: '○',
      label: 'Not yet checked against code',
      detail: 'Verify the map to see how many cited locations still resolve.',
    };
  }
  if (freshness.stale) {
    const broken = freshness.anchors_broken ?? 0;
    return {
      tone: 'stale',
      glyph: '▲',
      label: 'Map has drifted from code',
      detail: `${broken} of ${freshness.anchors_total} cited locations no longer resolve.`,
    };
  }
  return {
    tone: 'fresh',
    glyph: '●',
    label: 'Matches the code',
    detail: `All ${freshness.anchors_total} cited locations still resolve.`,
  };
}

export interface TrustRollup {
  /** Surfaces proven in code or stronger (trust rank at or above PROVEN_RANK). */
  proven: number;
  /** Surfaces still inferred or unverified. */
  unproven: number;
  total: number;
}

/**
 * Count how many surfaces are proven in code or stronger versus still inferred or unverified, from
 * the honest tiers already stamped into the stored map (FR-3). The map-level number keeps the visual
 * honest: it never claims more certainty than the elements earned, and a lower tier is never rolled
 * up as a higher one.
 */
export function trustRollup(map: AppMap): TrustRollup {
  let proven = 0;
  for (const surface of map.surfaces) {
    if (trustMeta(surface.trust).rank >= PROVEN_RANK) proven += 1;
  }
  const total = map.surfaces.length;
  return { proven, unproven: total - proven, total };
}
