export const SITE_MAP_SCHEMA_VERSION = 1;

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

export const VISIBILITIES = ['frontstage', 'backstage'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const DERIVATIONS = ['static', 'convention', 'agent', 'human'] as const;
export type Derivation = (typeof DERIVATIONS)[number];

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const TRUST_TIERS = [
  'unverified',
  'inferred',
  'proven-in-code',
  'proven-by-test',
  'human-confirmed',
] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const GUARD_MODES = ['deterministic', 'llm-judged'] as const;
export type GuardMode = (typeof GUARD_MODES)[number];

export const FLAG_LIFECYCLES = ['new', 'active', 'launched', 'inactive', 'stale'] as const;
export type FlagLifecycle = (typeof FLAG_LIFECYCLES)[number];

export const JOURNEY_STATUSES = ['proposed', 'confirmed', 'locked'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export interface Evidence {
  file: string;
  line?: number;
  note?: string;
}

export type EvidenceRef = Evidence | Evidence[];

export interface AppLanguage {
  default_locale: string;
  locales?: string[];
  catalogs?: string[];
  label_policy?: string;
}

export interface AppFreshness {
  anchors_total: number;
  anchors_resolved: number;
  anchors_broken: number;
}

export interface AppMeta {
  name: string;
  kind: AppKind | AppKind[];
  frameworks?: string[];
  generated_from?: string;
  freshness?: AppFreshness;
  language?: string | AppLanguage;
}

export interface Actor {
  id: string;
  label: string;
  satisfies?: string[];
  note?: string;
}

export interface Guard {
  id: string;
  kind: GuardKind;
  label: string;
  requires?: string;
  satisfy_via?: string;
  evidence?: EvidenceRef;
  trust?: TrustTier;
  flag_key?: string;
  required_variant?: string;
  provider?: string;
  owner?: string;
  lifecycle?: FlagLifecycle;
  introduced?: string;
  note?: string;
}

export interface Area {
  id: string;
  label: string;
  visibility?: Visibility;
  guard?: string | string[];
}

export interface SurfaceEntry {
  kind: string;
  value?: string;
  deep_link?: boolean;
}

export interface SurfaceVariant {
  flag: string;
  variant: string;
  adds?: string;
  changes?: string;
}

export interface SurfaceEnds {
  success?: boolean | string;
  failure?: boolean | string;
  abandoned?: boolean | string;
}

export interface HandOff {
  carries?: string;
  returns?: boolean;
}

export interface FlowStep {
  id: string;
  label?: string;
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
  trust?: TrustTier;
  mode?: 'link' | 'call';
  guard_text?: string;
  guard_mode?: GuardMode;
  utterances?: string[];
  fallback?: boolean;
  routing_description?: string;
}

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
  intent?: string;
  routing_description?: string;
  utterances?: string[];
  steps?: FlowStep[];
  transitions?: Transition[];
}

export interface JourneyIndexEntry {
  id: string;
  label: string;
  actor?: string;
  priority?: string;
  status?: JourneyStatus;
  trust?: TrustTier;
}

export interface AppMap {
  schema_version: number;
  app: AppMeta;
  actors?: Actor[];
  guards?: Guard[];
  areas?: Area[];
  surfaces: Surface[];
  journeys?: JourneyIndexEntry[];
}

export interface JourneyStep {
  surface: string;
  action?: string;
  expect?: string;
  step?: string;
  type?: string;
  variant?: { group?: string; when?: string };
}

export interface JourneyEnds {
  success?: unknown;
  failure?: unknown;
  abandoned?: unknown;
}

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
