export const ENGINE_ERROR_CODES = {
  MISSING_POLICY_CONTEXT: 'MISSING_POLICY_CONTEXT',
  DUPLICATE_SKILL_IDENTIFIER: 'DUPLICATE_SKILL_IDENTIFIER',
  DECISION_PACKET_CORRUPT: 'DECISION_PACKET_CORRUPT',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  VERSION_INCOMPATIBLE: 'VERSION_INCOMPATIBLE',
  MANIFEST_PRODUCTION_TIMEOUT: 'MANIFEST_PRODUCTION_TIMEOUT',
  WORKFLOW_ALREADY_RUNNING: 'WORKFLOW_ALREADY_RUNNING',
  VECTOR_INDEX_STORAGE_ERROR: 'VECTOR_INDEX_STORAGE_ERROR',
  CANCELLED_BY_CONSUMER: 'CANCELLED_BY_CONSUMER',
  LOGGER_SINK_FAILED: 'LOGGER_SINK_FAILED',
  UNKNOWN_ENGINE_ERROR: 'UNKNOWN_ENGINE_ERROR',
} as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[keyof typeof ENGINE_ERROR_CODES];

export interface EngineErrorPayloadBase extends Record<string, unknown> {
  retryable?: boolean;
  redacted_fields?: string[];
}

export interface MissingPolicyContextPayload extends EngineErrorPayloadBase {
  policy: string;
}

export interface DuplicateSkillIdentifierPayload extends EngineErrorPayloadBase {
  skill_id: string;
}

export interface DecisionPacketCorruptPayload extends EngineErrorPayloadBase {
  decision_id: string;
  reason: string;
  packet_path?: string;
}

export interface UnsupportedFileTypePayload extends EngineErrorPayloadBase {
  path: string;
  extension: string;
}

export interface VersionIncompatiblePayload extends EngineErrorPayloadBase {
  found: string;
  required: string;
  kind: 'engine-too-new' | 'engine-too-old' | 'schema';
}

export interface ManifestProductionTimeoutPayload extends EngineErrorPayloadBase {
  timeout_ms: number;
}

export interface WorkflowAlreadyRunningPayload extends EngineErrorPayloadBase {
  workflow: string;
  run_id?: string;
}

export interface VectorIndexStorageErrorPayload extends EngineErrorPayloadBase {
  index: string;
  reason: string;
}

export interface CancelledByConsumerPayload extends EngineErrorPayloadBase {
  checkpoint_path?: string;
}

export interface LoggerSinkFailedPayload extends EngineErrorPayloadBase {
  sink: string;
  reason: string;
}

export interface UnknownEngineErrorPayload extends EngineErrorPayloadBase {
  message?: string;
}

export interface TaxonomyEntry {
  code: EngineErrorCode;
  description: string;
  retryable: boolean;
  payload_shape: Record<string, string>;
}

const TAXONOMY: Record<EngineErrorCode, TaxonomyEntry> = {
  MISSING_POLICY_CONTEXT: {
    code: 'MISSING_POLICY_CONTEXT',
    description: 'A policy lookup was required but no policy context was available.',
    retryable: false,
    payload_shape: { policy: 'string' },
  },
  DUPLICATE_SKILL_IDENTIFIER: {
    code: 'DUPLICATE_SKILL_IDENTIFIER',
    description: 'A skill was registered under an identifier that is already in use.',
    retryable: false,
    payload_shape: { skill_id: 'string' },
  },
  DECISION_PACKET_CORRUPT: {
    code: 'DECISION_PACKET_CORRUPT',
    description: 'A decision packet on disk could not be parsed or failed validation.',
    retryable: false,
    payload_shape: { decision_id: 'string', reason: 'string', packet_path: 'string?' },
  },
  UNSUPPORTED_FILE_TYPE: {
    code: 'UNSUPPORTED_FILE_TYPE',
    description: 'A file was supplied whose type the engine does not support.',
    retryable: false,
    payload_shape: { path: 'string', extension: 'string' },
  },
  VERSION_INCOMPATIBLE: {
    code: 'VERSION_INCOMPATIBLE',
    description: 'The engine and consumer (or schema) versions are not compatible.',
    retryable: false,
    payload_shape: { found: 'string', required: 'string', kind: 'string' },
  },
  MANIFEST_PRODUCTION_TIMEOUT: {
    code: 'MANIFEST_PRODUCTION_TIMEOUT',
    description: 'Producing the planning manifest exceeded its configured timeout.',
    retryable: true,
    payload_shape: { timeout_ms: 'number' },
  },
  WORKFLOW_ALREADY_RUNNING: {
    code: 'WORKFLOW_ALREADY_RUNNING',
    description: 'A workflow run was requested while another holds the run lock.',
    retryable: false,
    payload_shape: { workflow: 'string', run_id: 'string?' },
  },
  VECTOR_INDEX_STORAGE_ERROR: {
    code: 'VECTOR_INDEX_STORAGE_ERROR',
    description: 'Persisting a vector index to disk failed.',
    retryable: true,
    payload_shape: { index: 'string', reason: 'string' },
  },
  CANCELLED_BY_CONSUMER: {
    code: 'CANCELLED_BY_CONSUMER',
    description: 'A long-running call was cancelled by the consumer via an AbortSignal.',
    retryable: false,
    payload_shape: { checkpoint_path: 'string?' },
  },
  LOGGER_SINK_FAILED: {
    code: 'LOGGER_SINK_FAILED',
    description: 'A log sink failed to accept a log entry.',
    retryable: true,
    payload_shape: { sink: 'string', reason: 'string' },
  },
  UNKNOWN_ENGINE_ERROR: {
    code: 'UNKNOWN_ENGINE_ERROR',
    description: 'An undocumented failure the taxonomy does not yet name.',
    retryable: false,
    payload_shape: { message: 'string?' },
  },
};

export function listErrorTaxonomy(): TaxonomyEntry[] {
  return Object.values(TAXONOMY);
}

export function getTaxonomyEntry(code: string): TaxonomyEntry | undefined {
  return (TAXONOMY as Record<string, TaxonomyEntry>)[code];
}
