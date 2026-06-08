// PQD-107 — the engine's stable, enumerated error taxonomy.
//
// Consumers (the desktop app or any other) route failure modes to UI
// behaviours by switching on `code` rather than parsing message strings. The
// taxonomy is a runtime value (so it can be enumerated via `listErrorTaxonomy`)
// and the `EngineErrorCode` union is derived from it, so the two never drift.
//
// Codes are SCREAMING_SNAKE_CASE conceptual names (not numeric registry codes):
// they are human-memorable and map directly to `switch` arms in consumer code.
// `CANCELLED_BY_CONSUMER` matches the code already carried by the PQD-104
// `CancelledError`, so the cancellation path surfaces a single stable code.

/**
 * Every stable error code the engine surfaces. Frozen runtime value; the
 * `EngineErrorCode` union below is derived from its keys so adding a code in
 * one place is enough.
 */
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

/** Stable error code surfaced on every typed engine error. */
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[keyof typeof ENGINE_ERROR_CODES];

/**
 * Fields common to every engine error payload. Individual payloads extend this
 * with the fields relevant to their code.
 */
export interface EngineErrorPayloadBase extends Record<string, unknown> {
  /** Whether the consumer may safely retry the operation. */
  retryable?: boolean;
  /** Names of payload fields whose values were stripped before surfacing. */
  redacted_fields?: string[];
}

export interface MissingPolicyContextPayload extends EngineErrorPayloadBase {
  /** Which policy lookup was attempted (e.g. workflow allow-list). */
  policy: string;
}

export interface DuplicateSkillIdentifierPayload extends EngineErrorPayloadBase {
  /** The identifier that collided. */
  skill_id: string;
}

export interface DecisionPacketCorruptPayload extends EngineErrorPayloadBase {
  decision_id: string;
  reason: string;
  /** Project-relative path to the offending packet, when known. */
  packet_path?: string;
}

export interface UnsupportedFileTypePayload extends EngineErrorPayloadBase {
  /** The rejected file path (project-relative). */
  path: string;
  /** The extension or kind that was not supported. */
  extension: string;
}

export interface VersionIncompatiblePayload extends EngineErrorPayloadBase {
  /** The version observed (engine or consumer, per `kind`). */
  found: string;
  /** The minimum/maximum version required. */
  required: string;
  /** Which side was incompatible. */
  kind: 'engine-too-new' | 'engine-too-old' | 'schema';
}

export interface ManifestProductionTimeoutPayload extends EngineErrorPayloadBase {
  /** The configured timeout that elapsed, in milliseconds. */
  timeout_ms: number;
}

export interface WorkflowAlreadyRunningPayload extends EngineErrorPayloadBase {
  /** The workflow or run already in flight. */
  workflow: string;
  /** The run id holding the lock, when known. */
  run_id?: string;
}

export interface VectorIndexStorageErrorPayload extends EngineErrorPayloadBase {
  /** Index that failed to persist (e.g. `file`, `vision`). */
  index: string;
  /** The underlying failure reason. */
  reason: string;
}

export interface CancelledByConsumerPayload extends EngineErrorPayloadBase {
  /** Resumable checkpoint left on disk, when the cancelled call wrote one. */
  checkpoint_path?: string;
}

export interface LoggerSinkFailedPayload extends EngineErrorPayloadBase {
  /** The sink that failed (e.g. `stderr`, a consumer logger). */
  sink: string;
  reason: string;
}

export interface UnknownEngineErrorPayload extends EngineErrorPayloadBase {
  /** Short, message-only description of the underlying failure. */
  message?: string;
}

/**
 * A single taxonomy entry, returned by `listErrorTaxonomy`. `payload_shape` is a
 * runtime-inspectable field→type-description map (e.g. `{ decision_id: 'string' }`)
 * so consumers and test harnesses can introspect the shape without TS reflection.
 */
export interface TaxonomyEntry {
  code: EngineErrorCode;
  description: string;
  /** The canonical default for this code; individual instances may override. */
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

/**
 * Return every taxonomy entry. The result is computed only from the static
 * `TAXONOMY` table — it is identical before and after any engine operation and
 * is safe to call before any operation has run.
 */
export function listErrorTaxonomy(): TaxonomyEntry[] {
  return Object.values(TAXONOMY);
}

/**
 * Look up a single taxonomy entry by code, or `undefined` if the code is not in
 * the taxonomy (used to detect undocumented failures).
 */
export function getTaxonomyEntry(code: string): TaxonomyEntry | undefined {
  return (TAXONOMY as Record<string, TaxonomyEntry>)[code];
}
