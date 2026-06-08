// Issue #109 — bidirectional traceability engine. Joins the existing forward
// link (obligation-extractor / compliance-checker), the module map, the import
// graph, and verification-evidence `ac_id` into one two-way promise ↔ code ↔
// test map, rebuilt from reality each run. It does not fork those subsystems.

export { solveReachability } from './reachability.js';
export type { ReachabilityInput, ReachabilityResult } from './reachability.js';
export { buildTraceabilityMap } from './map-builder.js';
export { gatherTraceabilityInputs } from './inputs.js';
export type { GatherOptions } from './inputs.js';
export { readTraceabilityMap, writeTraceabilityMap, traceabilityMapPath } from './writer.js';

export type {
  BackwardLink,
  BuildTraceabilityMapInput,
  CodeMarker,
  CodeRole,
  DeliveryEntry,
  ForwardLink,
  ProofEntry,
  PromiseRef,
  PromiseSource,
  TraceabilityCounts,
  TraceabilityFinding,
  TraceabilityFindingCode,
  TraceabilityMap,
} from '@/core/types/traceability.js';
export { TRACEABILITY_MAP_SCHEMA_VERSION } from '@/core/types/traceability.js';
