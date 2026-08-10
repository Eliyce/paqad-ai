// Tier-A trust-tier proof (issue #466, Part G — the deterministic half of the proof layer). The
// LLM authors the map and may claim any trust tier on any element, but nothing is trusted on its
// word: a tier is only ever *earned*, and it is perishable — it must be re-earned when the cited
// code changes (see TRUST_TIERS in core/types/site-map.ts). This module turns the map plus the
// gatherer's `file:line` resolutions into two deterministic, pure, reproducible outputs:
//
//   honestTrustTier(...)   — the tier an element may honestly *display*: an authored claim is
//                            capped down to what its code anchor supports, and a bare claim on a
//                            resolving anchor is upgraded to the `proven-in-code` it has earned.
//   deriveTrustFindings(...) — one SM-TRUST finding per element that claims MORE certainty than its
//                            evidence earns, so INV-3 ("no lower tier is shown as a higher one") is
//                            enforced mechanically rather than trusted.
//
// Both read the same three-state anchor of an element's evidence, so the display tier and the
// finding never disagree. The only I/O — resolving each `file:line` against the tree — is the
// gatherer's, exactly as `./verification.ts` consumes it; this module is pure over its inputs.

import { TRUST_TIERS, type AppMap, type Evidence, type TrustTier } from '@/core/types/site-map.js';

import {
  buildStatusOf,
  normalizeEvidence,
  type Candidate,
  type EvidenceResolution,
  type StatusOf,
} from './verification.js';

// The canonical single location the map is authored at (#466). Named here rather than imported so
// the trust findings read against the new location even while the shipped engine's other findings
// still name the superseded `docs/instructions/site-map/` path (retired in its own later commit).
const APP_MAP_PATH = 'docs/site-map/app-map.yaml';

const UNVERIFIED: TrustTier = 'unverified';
const INFERRED: TrustTier = 'inferred';
const PROVEN_IN_CODE: TrustTier = 'proven-in-code';

/** Order a tier by strength (its index in the canonical TRUST_TIERS, lowest to highest). */
function rank(tier: TrustTier): number {
  return TRUST_TIERS.indexOf(tier);
}

const strongest = (a: TrustTier, b: TrustTier): TrustTier => (rank(a) >= rank(b) ? a : b);
const weakest = (a: TrustTier, b: TrustTier): TrustTier => (rank(a) <= rank(b) ? a : b);

/**
 * How an element's `file:line` anchor stands right now:
 *  - `resolves` — it cites at least one pointer and every one resolves in the tree.
 *  - `broken`   — it cites at least one pointer and at least one no longer resolves.
 *  - `none`     — it cites no pointer at all, so there is no code anchor to prove anything.
 */
export type AnchorState = 'resolves' | 'broken' | 'none';

/** Reduce an element's evidence pointers, against the gatherer's verdicts, to one anchor state. */
function anchorState(pointers: Evidence[], statusOf: StatusOf): AnchorState {
  if (pointers.length === 0) return 'none';
  return pointers.every((pointer) => statusOf(pointer) === 'resolved') ? 'resolves' : 'broken';
}

/**
 * The tier an element may honestly display, given its authored claim (absent reads as the bare
 * `unverified`) and its anchor state — the single source of truth for the whole trust policy. A
 * resolving anchor *earns* `proven-in-code`, so a bare or weaker claim is raised to it while a
 * claim already stronger (a test or human attestation) stands, since a live anchor cannot refute
 * it. A broken anchor proves nothing — the tier is perishable — so every claim collapses to
 * `unverified`. A missing anchor can be no better than model inference, so a code- or
 * attestation-tier claim is capped down to `inferred`. An overstatement is exactly a claim this
 * function has to cap *down*, which is how `deriveTrustFindings` detects one.
 */
export function honestTrustTier(authored: TrustTier | undefined, state: AnchorState): TrustTier {
  const claim = authored ?? UNVERIFIED;
  if (state === 'broken') return UNVERIFIED;
  if (state === 'resolves') return strongest(claim, PROVEN_IN_CODE);
  return weakest(claim, INFERRED);
}

/** Build the single SM-TRUST finding for one element that overstates its trust tier. */
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

/** Test one element: a candidate iff the honest display had to cap its authored tier down. */
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

/**
 * SM-TRUST: every surface, transition, and guard whose declared trust tier claims more than its
 * `file:line` evidence deterministically earns. One finding per overstating element, each naming
 * the claimed tier, the earned ceiling, and why — the mechanical enforcement of INV-3. With no map
 * there is nothing to judge.
 */
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
