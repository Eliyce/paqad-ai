import type { Lane } from './routing.js';

export const TRACEABILITY_MAP_SCHEMA_VERSION = '1.0.0' as const;

export type PromiseSource = 'acceptance-criterion' | 'obligation';

export interface PromiseRef {
  promise_id: string;
  description: string;
  source: PromiseSource;
}

export interface ForwardLink {
  promise_id: string;
  source: PromiseSource;
  description: string;
  delivering_code: string[];
  proving_checks: string[];
  proven: boolean;
}

export type CodeRole = 'delivers-promise' | 'shared-groundwork' | 'orphan';

export interface BackwardLink {
  file: string;
  promise_ids: string[];
  used_by_promise: boolean;
  reached_from: string[];
  role: CodeRole;
}

export type TraceabilityFindingCode = 'TR-UNTESTED-PROMISE' | 'TR-CODE-ORPHAN';

export interface TraceabilityFinding {
  code: TraceabilityFindingCode;
  promise_id: string | null;
  paths: string[];
  detail: string;
}

export interface TraceabilityCounts {
  promises: number;
  untested_promises: number;
  delivers_promise: number;
  shared_groundwork: number;
  orphan_code: number;
}

export interface TraceabilityMap {
  schema_version: typeof TRACEABILITY_MAP_SCHEMA_VERSION;
  generated_at: string;
  lane: Lane;
  mode: 'full' | 'light';
  anchors_known: boolean;
  blocked_reason: string | null;
  forward: ForwardLink[];
  backward: BackwardLink[];
  findings: TraceabilityFinding[];
  counts: TraceabilityCounts;
  scope?: 'change';
  change?: string;
}

export interface DeliveryEntry {
  promise_id: string;
  files: string[];
}

export interface ProofEntry {
  promise_id: string;
  checks: string[];
}

export interface CodeMarker {
  file: string;
  promise_ids: string[];
}

export interface BuildTraceabilityMapInput {
  lane: Lane;
  now: () => string;
  promises: PromiseRef[];
  delivery: DeliveryEntry[];
  proofs: ProofEntry[];
  edges: Array<{ from: string; to: string }>;
  codeUniverse: string[];
  changedFiles?: string[];
  markers?: CodeMarker[];
}
