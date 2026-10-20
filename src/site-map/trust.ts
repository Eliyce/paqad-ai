import {
  TRUST_TIERS,
  type AppMap,
  type Evidence,
  type EvidenceRef,
  type TrustTier,
} from '@/core/types/site-map.js';

import {
  buildStatusOf,
  normalizeEvidence,
  type Candidate,
  type EvidenceResolution,
  type StatusOf,
} from './verification.js';

const APP_MAP_PATH = 'docs/site-map/app-map.yaml';

const UNVERIFIED: TrustTier = 'unverified';
const INFERRED: TrustTier = 'inferred';
const PROVEN_IN_CODE: TrustTier = 'proven-in-code';

function rank(tier: TrustTier): number {
  return TRUST_TIERS.indexOf(tier);
}

const strongest = (a: TrustTier, b: TrustTier): TrustTier => (rank(a) >= rank(b) ? a : b);
const weakest = (a: TrustTier, b: TrustTier): TrustTier => (rank(a) <= rank(b) ? a : b);

export type AnchorState = 'resolves' | 'broken' | 'none';

function anchorState(pointers: Evidence[], statusOf: StatusOf): AnchorState {
  if (pointers.length === 0) return 'none';
  return pointers.every((pointer) => statusOf(pointer) === 'resolved') ? 'resolves' : 'broken';
}

export function honestTrustTier(authored: TrustTier | undefined, state: AnchorState): TrustTier {
  const claim = authored ?? UNVERIFIED;
  if (state === 'broken') return UNVERIFIED;
  if (state === 'resolves') return strongest(claim, PROVEN_IN_CODE);
  return weakest(claim, INFERRED);
}

function overstatement(
  ownerId: string,
  ownerPhrase: string,
  affectedSurface: string | undefined,
  authored: TrustTier,
  earned: TrustTier,
  state: AnchorState,
): Candidate {
  const because =
    state === 'broken'
      ? 'its cited evidence no longer resolves in the tree'
      : 'it cites no evidence to prove that claim';
  return {
    title: `Overstated trust on ${ownerId}: claims "${authored}"`,
    description:
      `${ownerPhrase} is marked "${authored}", but ${because}, so the map shows it as more certain ` +
      `than the evidence earns (at most "${earned}").`,
    category: 'SM-TRUST',
    severity: 'medium',
    tier: 'deterministic',
    confidence: 1,
    evidence: [
      `${APP_MAP_PATH} — ${ownerId} declares trust "${authored}" but earns at most "${earned}" (${because})`,
    ],
    resolution:
      `Lower the trust on ${ownerId} to "${earned}" (or below) in ${APP_MAP_PATH}, or re-anchor its ` +
      'evidence to code that resolves so the claimed tier is earned.',
    affected_surfaces: affectedSurface === undefined ? [] : [affectedSurface],
    affected_files: [],
    baseline_status: 'unknown',
    status: 'open',
  };
}

function judge(
  authored: TrustTier | undefined,
  pointers: Evidence[],
  statusOf: StatusOf,
  build: (authored: TrustTier, earned: TrustTier, state: AnchorState) => Candidate,
): Candidate | undefined {
  if (authored === undefined) return undefined;
  const state = anchorState(pointers, statusOf);
  const earned = honestTrustTier(authored, state);
  if (rank(earned) >= rank(authored)) return undefined;
  return build(authored, earned, state);
}

export function deriveTrustFindings(
  map: AppMap | null,
  resolutions: EvidenceResolution[],
): Candidate[] {
  if (map === null) return [];
  const statusOf = buildStatusOf(resolutions);
  const candidates: Candidate[] = [];

  for (const surface of map.surfaces) {
    const surfaceFinding = judge(
      surface.trust,
      normalizeEvidence(surface.evidence),
      statusOf,
      (authored, earned, state) =>
        overstatement(
          `surface "${surface.id}"`,
          `Surface "${surface.label}"`,
          surface.id,
          authored,
          earned,
          state,
        ),
    );
    if (surfaceFinding !== undefined) candidates.push(surfaceFinding);

    for (const transition of surface.transitions ?? []) {
      const edgeFinding = judge(
        transition.trust,
        normalizeEvidence(transition.evidence),
        statusOf,
        (authored, earned, state) =>
          overstatement(
            `transition ${surface.id} → ${transition.to}`,
            `The transition from "${surface.id}" to "${transition.to}"`,
            surface.id,
            authored,
            earned,
            state,
          ),
      );
      if (edgeFinding !== undefined) candidates.push(edgeFinding);
    }
  }

  for (const guard of map.guards ?? []) {
    const guardFinding = judge(
      guard.trust,
      normalizeEvidence(guard.evidence),
      statusOf,
      (authored, earned, state) =>
        overstatement(
          `guard "${guard.id}"`,
          `Guard "${guard.label}"`,
          undefined,
          authored,
          earned,
          state,
        ),
    );
    if (guardFinding !== undefined) candidates.push(guardFinding);
  }

  return candidates;
}

type TrustBearing = { evidence?: EvidenceRef; trust?: TrustTier };

function stampOne<T extends TrustBearing>(
  element: T,
  statusOf: StatusOf,
): { element: T; changed: boolean } {
  const state = anchorState(normalizeEvidence(element.evidence), statusOf);
  const earned = honestTrustTier(element.trust, state);
  const next = earned === UNVERIFIED ? undefined : earned;
  if (element.trust === next) return { element, changed: false };
  const stamped = { ...element };
  if (next === undefined) delete stamped.trust;
  else stamped.trust = next;
  return { element: stamped, changed: true };
}

export interface StampedMap {
  map: AppMap;
  changed: boolean;
}

export function stampHonestTrustTiers(map: AppMap, resolutions: EvidenceResolution[]): StampedMap {
  const statusOf = buildStatusOf(resolutions);
  let changed = false;

  const surfaces = map.surfaces.map((surface) => {
    const stampedSurface = stampOne(surface, statusOf);
    if (stampedSurface.changed) changed = true;

    if (surface.transitions === undefined) return stampedSurface.element;

    let edgeChanged = false;
    const transitions = surface.transitions.map((transition) => {
      const stampedEdge = stampOne(transition, statusOf);
      if (stampedEdge.changed) {
        changed = true;
        edgeChanged = true;
      }
      return stampedEdge.element;
    });
    return edgeChanged ? { ...stampedSurface.element, transitions } : stampedSurface.element;
  });

  const guards = map.guards?.map((guard) => {
    const stampedGuard = stampOne(guard, statusOf);
    if (stampedGuard.changed) changed = true;
    return stampedGuard.element;
  });

  const stampedMap: AppMap =
    guards === undefined ? { ...map, surfaces } : { ...map, surfaces, guards };
  return { map: stampedMap, changed };
}
