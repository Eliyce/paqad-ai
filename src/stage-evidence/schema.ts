// AJV schema for `paqad.stage-evidence` rows (issue #247). Framework-owned, lives
// in src/ (never under .paqad/), so the LLM can never weaken it. Every recorded row
// is validated against this before it is appended.

import Ajv, { type ValidateFunction } from 'ajv';

import { STAGE_EVIDENCE_DOC_TYPE } from './types.js';

const nullableString = { type: ['string', 'null'] } as const;

export const STAGE_EVIDENCE_SCHEMA = {
  $id: 'paqad://schemas/stage-evidence.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'kind',
    'session_id',
    'conversation_ordinal',
    'ts',
    'adapter',
    'content_hash',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    doc_type: { const: STAGE_EVIDENCE_DOC_TYPE },
    kind: { enum: ['open', 'stage_start', 'stage_end', 'verify', 'close'] },
    session_id: { type: 'string', minLength: 1 },
    conversation_ordinal: { type: 'integer', minimum: 1 },
    ts: { type: 'string', minLength: 1 },
    adapter: { type: 'string', minLength: 1 },

    stage: nullableString,
    event_status: {
      type: ['string', 'null'],
      enum: ['started', 'completed', 'skipped', 'failed', 'redone', 'inferred', null],
    },
    evidence_source: {
      type: ['string', 'null'],
      enum: ['live-mark', 'inferred-artifact', 'inferred-git', 'redo', null],
    },
    artifact_paths: { type: ['array', 'null'], items: { type: 'string' } },
    artifact_digest: nullableString,
    subject_digest: nullableString,
    lane: { type: ['string', 'null'], enum: ['fast', 'graduated', 'full', null] },
    // The git branch the change is being built on, stamped on the `open` row (issue
    // #404). A session-id rotation does not change the branch, so this is what lets a
    // rotated session tell ITS in-flight bundle apart from every other open one.
    // Optional and nullable: rows written before it existed, and non-git projects,
    // carry no branch and still validate.
    branch: nullableString,
    note: nullableString,
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    compiled = ajv.compile(STAGE_EVIDENCE_SCHEMA);
  }
  return compiled;
}

/** One human-readable line for a validation error. Exported so the fallback arms
 *  (root-level path, ajv omitting a message) stay directly testable. */
export function formatValidationError(error: { instancePath?: string; message?: string }): string {
  return `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`;
}

/** Returns `[]` when the row is a valid `paqad.stage-evidence` row, else error strings. */
export function validateStageEvidenceRow(row: unknown): string[] {
  const validate = validator();
  if (validate(row)) {
    return [];
  }
  // ajv's contract: a false return always populates `errors` — no fallback branch.
  const errors = validate.errors as NonNullable<typeof validate.errors>;
  return errors.map(formatValidationError);
}
