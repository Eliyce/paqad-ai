// The Capability Kernel registry (buildout F3 — the unifying data model).
//
// The five sold mechanisms — feature-development stages, scripted-rule
// enforcement, the decision-pause contract, the narration contract, and the
// delivery policy — used to be five bespoke implementations scattered across the
// codebase, each with its own policy source, binding seam, ledger shape, and
// (mostly absent) evolution story. This registry makes them ONE versioned object
// — a CapabilityDescriptor — so a sixth contract is one row, not a new subsystem,
// and so the honest per-provider guarantee, the mode knobs, the ledger doc types,
// and the schema versions all read from a single source of truth that a
// consistency test pins against drift.
//
// This is the SEED: the descriptors (the metadata) land first. The executor that
// runs each capability's evaluate() at a host seam is wired in a later slice; the
// existing gates keep firing through their current paths until then, so this file
// is purely additive.

/** How strongly a capability can EVER bind, independent of the per-project mode.
 *  `unbindable` is an honest marker (narration is chat output — no host seam on
 *  any provider can observe it), never a failure. */
export type EnforcementFloor = 'block' | 'warn' | 'observe' | 'unbindable';

/** The host lifecycle point(s) a capability evaluates at. `pre-mutation` is
 *  Claude-only (the sole PreToolUse host); `completion` is every hook-capable
 *  host (Claude Stop, Codex/Gemini completion). */
export type CapabilitySeam = 'pre-mutation' | 'completion';

export interface CapabilityDescriptor {
  /** Stable id — NEVER renamed (an alias map handles a rename; a bare rename
   *  orphans the project's lock + config and resets the team's value). */
  id: 'stages' | 'rule-scripts' | 'decision-pause' | 'narration' | 'delivery';
  /** Human title for surfaces (dashboard, narration, docs). */
  title: string;
  /** The floored config knob that sets this capability's mode, or null when it
   *  has no mode (narration is unbindable). Must be a registered
   *  FRAMEWORK_CONFIG_SPEC key (the consistency test enforces this). */
  modeKey: string | null;
  /** The strongest guarantee this capability can offer on its best host. */
  enforcementFloor: EnforcementFloor;
  /** The seam(s) the capability evaluates at. Empty for `unbindable`. */
  seam: readonly CapabilitySeam[];
  /** The session-ledger `doc_type` its records are written under, or null when
   *  it writes none yet (decision-pause/delivery fold onto the ledger in F6). */
  ledgerDocType: string | null;
  /** Bumped when this capability's project-config shape changes (migration seam). */
  policySchemaVersion: number;
  /** Bumped when its ledger row shape changes (drives the per-capability migrator). */
  recordSchemaVersion: number;
}

/**
 * The one source of truth: the five capabilities as one frozen registry. Adding a
 * sixth contract is one row here. Order is display order.
 */
export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = Object.freeze([
  {
    id: 'stages',
    title: 'Feature-development stages',
    modeKey: 'stages_mode',
    enforcementFloor: 'block',
    seam: ['completion'],
    ledgerDocType: 'stage-evidence',
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'rule-scripts',
    title: 'Scripted-rule enforcement',
    modeKey: 'rule_compliance',
    enforcementFloor: 'block',
    seam: ['pre-mutation', 'completion'],
    ledgerDocType: null,
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'decision-pause',
    title: 'Decision Pause Contract',
    modeKey: null,
    // The deterministic teeth (ImplementationReviewGate on an OPEN packet) are
    // `block`; minting is advisory (the detector is a heuristic, never an
    // auto-blocker — buildout F-DP finding).
    enforcementFloor: 'block',
    seam: ['pre-mutation', 'completion'],
    ledgerDocType: 'decision-evidence',
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'narration',
    title: 'Narration contract',
    modeKey: null,
    // Chat-token cadence has NO host seam on any of the 10 providers — honestly
    // unbindable. The kernel records 'emitted', never 'verified'.
    enforcementFloor: 'unbindable',
    seam: [],
    ledgerDocType: null,
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'delivery',
    title: 'Delivery policy',
    modeKey: null,
    // No git/CI per the mandate: delivery binds only at completion (a bad push is
    // caught one turn late, never pre-push), so `warn` is its honest floor today.
    enforcementFloor: 'warn',
    seam: ['completion'],
    ledgerDocType: 'delivery-evidence',
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
]);

/** Look up a capability descriptor by id. */
export function getCapability(id: CapabilityDescriptor['id']): CapabilityDescriptor {
  const found = CAPABILITY_REGISTRY.find((capability) => capability.id === id);
  if (!found) {
    throw new Error(`Unknown capability id: ${id}`);
  }
  return found;
}

/** Capabilities that evaluate at a given host seam (drives the future gate). */
export function capabilitiesForSeam(seam: CapabilitySeam): readonly CapabilityDescriptor[] {
  return CAPABILITY_REGISTRY.filter((capability) => capability.seam.includes(seam));
}
