export const BOUNDARY_SCHEMA_VERSION = 1 as const;

export type BoundaryRelationship =
  'producer_consumer' | 'bidirectional' | 'shared_utility' | 'unanalyzable';

export interface BoundaryInterface {
  type_name: string;
  file: string;
  producer_spec: string | null;
  consumer_specs: string[];
  output_states: string[];
  relationship: BoundaryRelationship;
}

export interface UnhandledVariant {
  type_name: string;
  state: string;
  producer_spec: string | null;
  consumer_spec: string;
}

export interface BoundaryManifest {
  metadata: {
    generated_at: string;
    schema_version: number;
  };
  boundaries: BoundaryInterface[];
}

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
