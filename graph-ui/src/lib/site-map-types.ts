// Client-side shape of the static site-map payload the server serves on GET /api/site-map/map
// (issue #466). graph-ui is a separate package and cannot import the engine's types, so this
// mirrors the fields the visual reads. The dashboard renders this as-is — no LLM at view time.

export type TrustTier =
  'unverified' | 'inferred' | 'proven-in-code' | 'proven-by-test' | 'human-confirmed';

export interface Evidence {
  file: string;
  line?: number;
  note?: string;
}

export type EvidenceRef = Evidence | Evidence[];

export interface Transition {
  to: string;
  trigger: string;
  guard?: string | string[];
  guard_not?: string;
  note?: string;
  evidence?: EvidenceRef;
  confidence?: 'high' | 'medium' | 'low';
  trust?: TrustTier;
  guard_text?: string;
  guard_mode?: 'deterministic' | 'llm-judged';
  fallback?: boolean;
}

export type SurfaceKind =
  | 'page'
  | 'screen'
  | 'modal'
  | 'action'
  | 'api'
  | 'cli-command'
  | 'job'
  | 'webhook'
  | 'email'
  | 'external-system'
  | 'prompt-entry'
  | 'router'
  | 'llm-workflow'
  | 'step'
  | 'decision-pause'
  | 'handoff'
  | 'subflow'
  | 'terminal';

export interface Surface {
  id: string;
  kind: SurfaceKind;
  label: string;
  area?: string;
  entry?: { kind: string; value?: string; deep_link?: boolean };
  guard?: string | string[];
  evidence?: EvidenceRef;
  derivation?: 'static' | 'convention' | 'agent' | 'human';
  confidence?: 'high' | 'medium' | 'low';
  trust?: TrustTier;
  module?: string;
  status?: string;
  note?: string;
  ends?: { success?: unknown; failure?: unknown; abandoned?: unknown };
  transitions?: Transition[];
}

export interface Area {
  id: string;
  label: string;
  visibility?: 'frontstage' | 'backstage';
  guard?: string | string[];
}

export interface Actor {
  id: string;
  label: string;
  satisfies?: string[];
  note?: string;
}

export interface Guard {
  id: string;
  kind: string;
  label: string;
  requires?: string;
  satisfy_via?: string;
  evidence?: EvidenceRef;
  trust?: TrustTier;
}

export interface JourneyIndexEntry {
  id: string;
  label: string;
  actor?: string;
  priority?: string;
  status?: 'proposed' | 'confirmed' | 'locked';
  trust?: TrustTier;
}

export interface AppMap {
  schema_version: number;
  app: { name: string; kind: string | string[]; frameworks?: string[]; generated_from?: string };
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
}

export interface Journey {
  schema_version: number;
  id: string;
  label: string;
  actor: string;
  goal: string;
  entry: string;
  steps: JourneyStep[];
  ends: { success?: unknown; failure?: unknown; abandoned?: unknown };
  status: 'proposed' | 'confirmed' | 'locked';
  priority?: string;
  trust?: TrustTier;
}

export interface SiteMapFreshness {
  generated_from: string | null;
}

/** The two documentation-family workflows site-map creation depends on, named as the person
 *  invokes them (mirrors the engine's SiteMapPrerequisiteWorkflow). */
export type SiteMapPrerequisiteWorkflow = 'create documentation' | 'create module documentation';

/** One unmet prerequisite the blocked state names: the workflow to run and why it matters. */
export interface MissingSiteMapPrerequisite {
  workflow: SiteMapPrerequisiteWorkflow;
  reason: string;
}

/** The discriminated union the server returns; the client renders exactly one honest state. */
export type SiteMapView =
  | { status: 'disabled' }
  | { status: 'blocked'; missing: MissingSiteMapPrerequisite[] }
  | { status: 'empty' }
  | { status: 'ready'; map: AppMap; journeys: Journey[]; freshness: SiteMapFreshness };

/** Normalize a single-or-list evidence ref to an array (empty when absent). */
export function evidenceList(ref: EvidenceRef | undefined): Evidence[] {
  if (ref === undefined) return [];
  return Array.isArray(ref) ? ref : [ref];
}

/** Normalize a single-or-list guard ref to an array (empty when absent). */
export function guardList(ref: string | string[] | undefined): string[] {
  if (ref === undefined) return [];
  return Array.isArray(ref) ? ref : [ref];
}
