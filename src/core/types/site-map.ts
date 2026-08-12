// Types for the Site Map & Journeys capability — the behavioural map of an application
// (surfaces, transitions, guards, actors, and curated journeys). Schema-versioned and
// AJV-validated; the committed JSON schemas live in `src/validators/schemas/`. This file
// is the single TypeScript source for the map (`app-map.yaml`) and per-journey documents;
// findings, the run report, and the baseline live in a sibling type module added with the
// engine. See docs/specs/site-map-capability.{proposal,plan,addendum}.md.

/** Bumped when the persisted map shape changes; the store rejects a mismatched file. */
export const SITE_MAP_SCHEMA_VERSION = 1;

/** The application shapes a map can describe; one product may be several at once. */
export const APP_KINDS = [
  'web',
  'api',
  'cli',
  'mobile',
  'desktop',
  'service',
  'llm-workflows',
] as const;
export type AppKind = (typeof APP_KINDS)[number];

/**
 * The kinds of place a user or caller can be. The first block is the classic surface
 * families; the second is the prompt-workflow node family (addendum §5) — a router, its
 * steps, human pauses, hand-offs, and terminals — carried as surfaces so one graph holds
 * every family.
 */
export const SURFACE_KINDS = [
  'page',
  'screen',
  'modal',
  'action',
  'api',
  'cli-command',
  'job',
  'webhook',
  'email',
  'external-system',
  // prompt-flow node kinds:
  'prompt-entry',
  'router',
  'llm-workflow',
  'step',
  'decision-pause',
  'handoff',
  'subflow',
  'terminal',
] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

/** Typed guard kinds (NIST RBAC vocabulary + flag/state/capability/environment). */
export const GUARD_KINDS = [
  'permission',
  'role',
  'feature-flag',
  'auth-state',
  'data-state',
  'capability',
  'environment',
] as const;
export type GuardKind = (typeof GUARD_KINDS)[number];

/** Service-blueprint line of visibility: what the user consciously experiences vs support. */
export const VISIBILITIES = ['frontstage', 'backstage'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** How a fact was derived — its provenance tier. */
export const DERIVATIONS = ['static', 'convention', 'agent', 'human'] as const;
export type Derivation = (typeof DERIVATIONS)[number];

/** How sure we are of a derived fact. */
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * How strongly an element is proven, lowest to highest (issue #466, PROOF-14). The LLM authors
 * the map, but nothing is trusted on its word: a tier is only earned. `unverified` is a bare
 * LLM claim; `inferred` is convention- or consistency-checked but still model-judged;
 * `proven-in-code` is confirmed by a deterministic check; `proven-by-test` is traversed by a
 * passing test; `human-confirmed` is attested by a person. A lower tier is never shown as a
 * higher one, and the tier is perishable — it must be re-earned when the underlying code changes.
 */
export const TRUST_TIERS = [
  'unverified',
  'inferred',
  'proven-in-code',
  'proven-by-test',
  'human-confirmed',
] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

/** Whether a router edge is machine-evaluable or judged by the model (the honesty marker). */
export const GUARD_MODES = ['deterministic', 'llm-judged'] as const;
export type GuardMode = (typeof GUARD_MODES)[number];

/** Feature-flag lifecycle (LaunchDarkly staleness); `launched`/`stale` ⇒ cleanup candidate. */
export const FLAG_LIFECYCLES = ['new', 'active', 'launched', 'inactive', 'stale'] as const;
export type FlagLifecycle = (typeof FLAG_LIFECYCLES)[number];

/** Curation status of a journey; a `proposed` journey may be index-only (no file yet). */
export const JOURNEY_STATUSES = ['proposed', 'confirmed', 'locked'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

/** A single evidence pointer into the code (or a labelled note). */
export interface Evidence {
  file: string;
  line?: number;
  note?: string;
}

/** Evidence is either one pointer or a list of them. */
export type EvidenceRef = Evidence | Evidence[];

/** The i18n layer, when the product has one (addendum §2). */
export interface AppLanguage {
  default_locale: string;
  locales?: string[];
  /** Translation-catalog locations the extractor reads. */
  catalogs?: string[];
  label_policy?: string;
}

/**
 * How stale the whole map is against the code it cites (issue #466, Part G, FRESH-1). A count of the
 * distinct `file:line` anchors the map cites and how many still resolve in the tree, stamped into the
 * stored map at author/verify time so the dashboard can read freshness statically, with no resolution
 * work at view time (NFR-4). Counts only, never a timestamp, so re-stamping an unchanged map over
 * unchanged code stays a byte-for-byte no-op. A non-zero `anchors_broken` means the code the map
 * points to has moved, so the map is stale by exactly that many anchors.
 */
export interface AppFreshness {
  /** Distinct cited `file:line` anchors across surfaces, transitions, and guards. */
  anchors_total: number;
  /** How many of those anchors still resolve in the tree. */
  anchors_resolved: number;
  /** How many no longer resolve — the map is stale against code by exactly this many. */
  anchors_broken: number;
}

/** Header describing the mapped product. */
export interface AppMeta {
  name: string;
  kind: AppKind | AppKind[];
  frameworks?: string[];
  generated_from?: string;
  /** Deterministic map-vs-code freshness, stamped at author/verify time (issue #466). */
  freshness?: AppFreshness;
  /** A bare default locale (`en`) or the full i18n block. */
  language?: string | AppLanguage;
}

/** Who travels the map. An actor is a permission bundle, which makes "view as" computable. */
export interface Actor {
  id: string;
  label: string;
  /** Guard ids this actor satisfies. */
  satisfies?: string[];
  note?: string;
}

/** A named, satisfiable condition on entry or traversal. */
export interface Guard {
  id: string;
  kind: GuardKind;
  label: string;
  requires?: string;
  /** The testability hint: how to become able to cross this guard. */
  satisfy_via?: string;
  evidence?: EvidenceRef;
  /** How strongly this guard is proven (issue #466, PROOF-14). */
  trust?: TrustTier;
  // feature-flag guards carry a (flag_key, required_variant) pair, never a raw value:
  flag_key?: string;
  required_variant?: string;
  provider?: string;
  owner?: string;
  lifecycle?: FlagLifecycle;
  introduced?: string;
  note?: string;
}

/** A district of the visual map. */
export interface Area {
  id: string;
  label: string;
  visibility?: Visibility;
  guard?: string | string[];
}

/** How a surface is entered from outside the graph. */
export interface SurfaceEntry {
  kind: string;
  value?: string;
  deep_link?: boolean;
}

/** A flag-driven variation that lives inside a surface (annotate, don't duplicate). */
export interface SurfaceVariant {
  flag: string;
  variant: string;
  adds?: string;
  changes?: string;
}

/** Terminal markers for a surface. Values are permissive (a bool, a label, or a state id). */
export interface SurfaceEnds {
  success?: boolean | string;
  failure?: boolean | string;
  abandoned?: boolean | string;
}

/** How a boundary hand-off behaves (external-system surfaces). */
export interface HandOff {
  carries?: string;
  returns?: boolean;
}

/** A step inside a prompt-workflow surface (addendum §5). */
export interface FlowStep {
  id: string;
  label?: string;
  /** llm | tool | collect | decision-pause. */
  type?: string;
  visibility?: Visibility;
  visible?: string;
  artifact?: string;
  presents?: string;
  decisions?: string[];
  resumable?: boolean;
  inputs?: string[];
  outputs?: string[];
}

/** A directed move between surfaces, with its trigger and (optional) guard. */
export interface Transition {
  to: string;
  trigger: string;
  guard?: string | string[];
  guard_not?: string;
  note?: string;
  via?: string;
  carries?: string;
  visibility?: Visibility;
  evidence?: EvidenceRef;
  confidence?: Confidence;
  /** How strongly this transition is proven (issue #466, PROOF-14). */
  trust?: TrustTier;
  /** For handoff/subflow edges: `link` (no return) vs `call` (returns). */
  mode?: 'link' | 'call';
  // router-edge fields (prompt-flow):
  guard_text?: string;
  guard_mode?: GuardMode;
  utterances?: string[];
  fallback?: boolean;
  routing_description?: string;
}

/** Any place a user or caller can be; outgoing transitions are listed inline (incident encoding). */
export interface Surface {
  id: string;
  kind: SurfaceKind;
  label: string;
  label_key?: string;
  label_source?: string;
  labels?: Record<string, string>;
  area?: string;
  entry?: SurfaceEntry;
  page_type?: string;
  module?: string;
  guard?: string | string[];
  guard_not?: string;
  evidence?: EvidenceRef;
  derivation?: Derivation;
  confidence?: Confidence;
  /** How strongly this surface is proven (issue #466, PROOF-14). */
  trust?: TrustTier;
  visibility?: Visibility;
  variants?: SurfaceVariant[];
  variant_group?: string;
  variant_of?: string;
  status?: string;
  oracle?: Record<string, string>;
  hand_off?: HandOff;
  ends?: SurfaceEnds;
  note?: string;
  actor?: string;
  // prompt-flow surface fields:
  intent?: string;
  routing_description?: string;
  utterances?: string[];
  steps?: FlowStep[];
  transitions?: Transition[];
}

/** One row in the map's journey index. */
export interface JourneyIndexEntry {
  id: string;
  label: string;
  actor?: string;
  priority?: string;
  status?: JourneyStatus;
  /** How strongly this journey is proven (issue #466, PROOF-14). */
  trust?: TrustTier;
}

/** The canonical behavioural map (`app-map.yaml`). */
export interface AppMap {
  schema_version: number;
  app: AppMeta;
  actors?: Actor[];
  guards?: Guard[];
  areas?: Area[];
  surfaces: Surface[];
  journeys?: JourneyIndexEntry[];
}

/** One step of a curated journey. */
export interface JourneyStep {
  surface: string;
  action?: string;
  expect?: string;
  /** The named flow step, for prompt-workflow journeys. */
  step?: string;
  type?: string;
  variant?: { group?: string; when?: string };
}

/** Terminal states of a journey (permissive value shapes, matching the hand-authored samples). */
export interface JourneyEnds {
  success?: unknown;
  failure?: unknown;
  abandoned?: unknown;
}

/** A curated, goal-directed path through the map (`journeys/<id>.journey.yaml`). */
export interface Journey {
  schema_version: number;
  id: string;
  label: string;
  actor: string;
  on_behalf_of?: string;
  goal: string;
  entry: string;
  uses?: string[];
  steps: JourneyStep[];
  branches?: unknown[];
  ends: JourneyEnds;
  next_journeys?: string[];
  tests?: unknown[];
  priority?: string;
  status: JourneyStatus;
  derivation?: Derivation;
  evidence?: EvidenceRef;
}
