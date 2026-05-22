export const BOUNDARY_SCHEMA_VERSION = 1 as const;

/**
 * How each spec relates to the shared type (FR-BT1.3).
 */
export type BoundaryRelationship =
  | 'producer_consumer'
  | 'bidirectional'
  | 'shared_utility'
  | 'unanalyzable';

/**
 * A single shared type boundary detected via @boundary annotation or TypeScript
 * enum/union export (FR-BT1.2).
 */
export interface BoundaryInterface {
  /** TypeScript type / enum name, e.g. "GateResult". */
  type_name: string;
  /** Source file where the type is declared. */
  file: string;
  /** Spec that produces instances of this type (null when unresolved). */
  producer_spec: string | null;
  /** Specs that consume instances of this type. */
  consumer_specs: string[];
  /** All possible states/values the producer can emit. */
  output_states: string[];
  relationship: BoundaryRelationship;
}

/** Unhandled variant — a state the producer emits that a consumer never references. */
export interface UnhandledVariant {
  type_name: string;
  state: string;
  producer_spec: string | null;
  consumer_spec: string;
}

/** Persisted boundary manifest at .paqad/compliance/boundary-manifest.json. */
export interface BoundaryManifest {
  metadata: {
    generated_at: string;
    schema_version: number;
  };
  boundaries: BoundaryInterface[];
}

/** Boundary coverage report at .paqad/compliance/boundary-report.json. */
export interface BoundaryReport {
  metadata: {
    generated_at: string;
    schema_version: number;
  };
  total_interfaces: number;
  total_states: number;
  handled_count: number;
  unhandled_count: number;
  gate_result: 'pass' | 'warn' | 'skip';
  interfaces: BoundaryInterfaceReport[];
}

export interface BoundaryInterfaceReport {
  type_name: string;
  file: string;
  producer_spec: string | null;
  consumer_specs: string[];
  total_states: number;
  unhandled_variants: UnhandledVariant[];
}
