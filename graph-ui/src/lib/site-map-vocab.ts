import type { AppMap, SiteMapFreshness, SurfaceKind, TrustTier } from './site-map-types';

export type NodeShape = 'rounded' | 'diamond' | 'stadium' | 'slanted';

export interface KindMeta {
  family: string;
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

export const KIND_LEGEND: { family: string; shape: NodeShape }[] = [
  { family: 'Screen', shape: 'rounded' },
  { family: 'Action', shape: 'rounded' },
  { family: 'Decision', shape: 'diamond' },
  { family: 'External', shape: 'slanted' },
  { family: 'End', shape: 'stadium' },
];

export interface TrustMeta {
  label: string;
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

export const PROVEN_RANK = 2;

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
  glyph: string;
  label: string;
  detail: string;
}

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
  proven: number;
  unproven: number;
  total: number;
}

export function trustRollup(map: AppMap): TrustRollup {
  let proven = 0;
  for (const surface of map.surfaces) {
    if (trustMeta(surface.trust).rank >= PROVEN_RANK) proven += 1;
  }
  const total = map.surfaces.length;
  return { proven, unproven: total - proven, total };
}
