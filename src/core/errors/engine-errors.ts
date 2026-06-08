// PQD-107 — typed error subclasses, one per taxonomy code, so a consumer can
// `instanceof`-check and read a strongly-typed `details` payload. Each subclass
// fixes its `code`, sets the canonical `retryable` default for that code, and
// threads an optional `projectRoot` through so credential material in the
// payload is redacted before the error is surfaced.
//
// `CANCELLED_BY_CONSUMER` is intentionally NOT redefined here: the PQD-104
// `CancelledError` (exported from the same errors barrel) already carries that
// code, so cancellation surfaces a single stable class.

import { engineLog } from '@/core/logger-registry.js';

import { FrameworkError } from './framework-error.js';
import {
  ENGINE_ERROR_CODES,
  getTaxonomyEntry,
  type DecisionPacketCorruptPayload,
  type DuplicateSkillIdentifierPayload,
  type EngineErrorCode,
  type LoggerSinkFailedPayload,
  type ManifestProductionTimeoutPayload,
  type MissingPolicyContextPayload,
  type UnknownEngineErrorPayload,
  type UnsupportedFileTypePayload,
  type VectorIndexStorageErrorPayload,
  type VersionIncompatiblePayload,
  type WorkflowAlreadyRunningPayload,
} from './taxonomy.js';

export class MissingPolicyContextError extends FrameworkError {
  declare readonly code: 'MISSING_POLICY_CONTEXT';

  constructor(message: string, details: MissingPolicyContextPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.MISSING_POLICY_CONTEXT,
      details,
      retryable: false,
      projectRoot,
    });
    this.name = 'MissingPolicyContextError';
  }
}

export class DuplicateSkillIdentifierError extends FrameworkError {
  declare readonly code: 'DUPLICATE_SKILL_IDENTIFIER';

  constructor(message: string, details: DuplicateSkillIdentifierPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.DUPLICATE_SKILL_IDENTIFIER,
      details,
      retryable: false,
      projectRoot,
    });
    this.name = 'DuplicateSkillIdentifierError';
  }
}

export class DecisionPacketCorruptError extends FrameworkError {
  declare readonly code: 'DECISION_PACKET_CORRUPT';

  constructor(message: string, details: DecisionPacketCorruptPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.DECISION_PACKET_CORRUPT,
      details,
      retryable: false,
      projectRoot,
    });
    this.name = 'DecisionPacketCorruptError';
  }
}

export class UnsupportedFileTypeError extends FrameworkError {
  declare readonly code: 'UNSUPPORTED_FILE_TYPE';

  constructor(message: string, details: UnsupportedFileTypePayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      details,
      retryable: false,
      projectRoot,
    });
    this.name = 'UnsupportedFileTypeError';
  }
}

export class VersionIncompatibleError extends FrameworkError {
  declare readonly code: 'VERSION_INCOMPATIBLE';

  constructor(message: string, details: VersionIncompatiblePayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.VERSION_INCOMPATIBLE,
      details,
      retryable: false,
      projectRoot,
    });
    this.name = 'VersionIncompatibleError';
  }
}

export class ManifestProductionTimeoutError extends FrameworkError {
  declare readonly code: 'MANIFEST_PRODUCTION_TIMEOUT';

  constructor(message: string, details: ManifestProductionTimeoutPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.MANIFEST_PRODUCTION_TIMEOUT,
      details,
      retryable: true,
      projectRoot,
    });
    this.name = 'ManifestProductionTimeoutError';
  }
}

export class WorkflowAlreadyRunningError extends FrameworkError {
  declare readonly code: 'WORKFLOW_ALREADY_RUNNING';

  constructor(message: string, details: WorkflowAlreadyRunningPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.WORKFLOW_ALREADY_RUNNING,
      details,
      retryable: false,
      projectRoot,
    });
    this.name = 'WorkflowAlreadyRunningError';
  }
}

export class VectorIndexStorageError extends FrameworkError {
  declare readonly code: 'VECTOR_INDEX_STORAGE_ERROR';

  constructor(message: string, details: VectorIndexStorageErrorPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.VECTOR_INDEX_STORAGE_ERROR,
      details,
      retryable: true,
      projectRoot,
    });
    this.name = 'VectorIndexStorageError';
  }
}

export class LoggerSinkFailedError extends FrameworkError {
  declare readonly code: 'LOGGER_SINK_FAILED';

  constructor(message: string, details: LoggerSinkFailedPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.LOGGER_SINK_FAILED,
      details,
      retryable: true,
      projectRoot,
    });
    this.name = 'LoggerSinkFailedError';
  }
}

export class UnknownEngineError extends FrameworkError {
  declare readonly code: 'UNKNOWN_ENGINE_ERROR';

  constructor(message: string, details?: UnknownEngineErrorPayload, projectRoot?: string) {
    super(message, {
      code: ENGINE_ERROR_CODES.UNKNOWN_ENGINE_ERROR,
      details,
      retryable: false,
      projectRoot,
    });
    this.name = 'UnknownEngineError';
  }
}

/**
 * Normalise any thrown value into an engine error carrying a taxonomy code.
 *
 * - A {@link FrameworkError} whose `code` is already in the taxonomy passes
 *   through unchanged.
 * - A {@link CancelledError} (or any framework error) is preserved.
 * - Anything else — including a `FrameworkError` with a code the taxonomy does
 *   not name — is wrapped in {@link UnknownEngineError}, and the engine emits an
 *   internal log naming the missing taxonomy entry (AC: undocumented failure).
 */
export function toEngineError(error: unknown): FrameworkError {
  if (error instanceof FrameworkError) {
    if (getTaxonomyEntry(error.code)) {
      return error;
    }
    engineLog('error', 'Engine error code is not in the taxonomy; surfacing UNKNOWN_ENGINE_ERROR', {
      missing_code: error.code,
    });
    return new UnknownEngineError(error.message, { message: error.message }, undefined);
  }

  const message = error instanceof Error ? error.message : String(error);
  return new UnknownEngineError(message, { message });
}

/** True when `code` is a value the engine taxonomy defines. */
export function isEngineErrorCode(code: string): code is EngineErrorCode {
  return getTaxonomyEntry(code) !== undefined;
}
