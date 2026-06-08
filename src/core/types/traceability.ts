// Issue #109 — bidirectional traceability map (promise ↔ code ↔ test).
//
// A "promise" is one frozen acceptance criterion (owned by #102) or an
// extracted obligation (owned by the compliance engine). This module joins the
// existing forward link (spec → test, via obligation-extractor/compliance-
// checker) with the module-map and verification-evidence `ac_id` so every
// promise links forward to delivering code + a proving check, and every code
// unit links backward to a promise — or to shared groundwork that something-
// with-a-promise actually USES (reachability, not a label). It is rebuilt from
// reality each run; nothing here is hand-maintained.

import type { Lane } from './routing.js';

export const TRACEABILITY_MAP_SCHEMA_VERSION = '1.0.0' as const;

/** Where a promise comes from. Both are real promises; the source is recorded
 *  so the forward anchor is auditable. */
export type PromiseSource = 'acceptance-criterion' | 'obligation';

export interface PromiseRef {
  /** AC-\d+ (from #102) or an obligation_id (from the compliance engine). */
  promise_id: string;
  description: string;
  source: PromiseSource;
}

/** Forward: promise → the code that delivers it → the check that proves it. */
export interface ForwardLink {
  promise_id: string;
  source: PromiseSource;
  description: string;
  /** Project-relative files inferred to deliver this promise (change set +
   *  module map, optionally sharpened by explicit markers). */
  delivering_code: string[];
  /** Test files / gate ids that prove this promise (compliance evidence +
   *  verification-evidence `ac_id`). */
  proving_checks: string[];
  /** True iff at least one proving check exists. A false value is the
   *  "untested promise" signal. */
  proven: boolean;
}

/** How a code file relates to the promise set. */
export type CodeRole = 'delivers-promise' | 'shared-groundwork' | 'orphan';

/** Backward: each code file → a promise, or to a promise-backed user. */
export interface BackwardLink {
  file: string;
  /** Promises this file directly delivers (may be empty). */
  promise_ids: string[];
  /** True iff this file is reachable from a promise-delivering file via the
   *  import graph — i.e. something-with-a-promise actually uses it. */
  used_by_promise: boolean;
  /** Up to a few anchor files that reach this one (evidence of use). */
  reached_from: string[];
  role: CodeRole;
}

export type TraceabilityFindingCode = 'TR-UNTESTED-PROMISE' | 'TR-CODE-ORPHAN';

export interface TraceabilityFinding {
  code: TraceabilityFindingCode;
  /** The promise involved (TR-UNTESTED-PROMISE); null for orphan code. */
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
  /** `full` builds the whole two-way map; `light` (fast lane) checks only the
   *  change set — "did this trivial change add code with no promise/no user?" */
  mode: 'full' | 'light';
  /** When false, no promise anchors were discoverable this run, so orphan code
   *  cannot be told apart from shared groundwork — orphan flagging is suppressed
   *  rather than flagging the whole tree. The reason is recorded for honesty. */
  anchors_known: boolean;
  blocked_reason: string | null;
  forward: ForwardLink[];
  backward: BackwardLink[];
  findings: TraceabilityFinding[];
  counts: TraceabilityCounts;
}

/** Maps a promise to the code inferred to deliver it. */
export interface DeliveryEntry {
  promise_id: string;
  files: string[];
}

/** Maps a promise to the checks that prove it. */
export interface ProofEntry {
  promise_id: string;
  checks: string[];
}

/** Optional explicit code→promise markers (`@obligation` / `@ac` in source).
 *  Sharpens the inferred links; never the sole acceptance signal. */
export interface CodeMarker {
  file: string;
  promise_ids: string[];
}

export interface BuildTraceabilityMapInput {
  lane: Lane;
  now: () => string;
  /** Frozen acceptance criteria (#102) + extracted obligations. */
  promises: PromiseRef[];
  /** Inferred promise → delivering code. */
  delivery: DeliveryEntry[];
  /** promise → proving checks. */
  proofs: ProofEntry[];
  /** Resolved import edges (`from` imports `to`), both project-relative. */
  edges: Array<{ from: string; to: string }>;
  /** All source files in scope for the backward map. */
  codeUniverse: string[];
  /** Files changed this run. In `fast` lane, orphan flagging is restricted to
   *  this set (the cheap subset). Ignored on graduated/full. */
  changedFiles?: string[];
  /** Optional explicit code→promise markers. */
  markers?: CodeMarker[];
}
