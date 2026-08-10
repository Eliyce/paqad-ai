// The small, fixed visual vocabulary for the site map (issue #466, UXR-10). A person never has
// to guess what a shape means: every node kind maps to one of a handful of families, each with a
// plain-language name and a shape that reads without colour (A11Y-3). Trust tiers get an honest,
// non-colour label too, so a lower tier is never shown as a higher one (PROOF-15).

import type { SurfaceKind, TrustTier } from './site-map-types';

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
