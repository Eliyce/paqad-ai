export { solveReachability } from './reachability.js';
export type { ReachabilityInput, ReachabilityResult } from './reachability.js';
export { buildTraceabilityMap } from './map-builder.js';
export { gatherTraceabilityInputs, readObligationPromises } from './inputs.js';
export type { GatherOptions } from './inputs.js';
export {
  buildAndWriteChangeTraceabilityMap,
  buildChangeTraceabilityMap,
  extractTitlesAndTags,
  namesCriterion,
} from './change-map.js';
export type {
  BuildChangeTraceabilityMapOptions,
  ChangeTraceabilityBuild,
  ChangeTraceabilityResult,
} from './change-map.js';
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
