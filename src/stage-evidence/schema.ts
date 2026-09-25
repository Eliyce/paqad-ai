// AJV schema for `paqad.stage-evidence` rows (issue #247). Framework-owned, lives
// in src/ (never under .paqad/), so the LLM can never weaken it. Every recorded row
// is validated against this before it is appended.

import Ajv, { type ValidateFunction } from 'ajv';

import { STAGE_EVIDENCE_DOC_TYPE, STAGE_EVIDENCE_SCHEMA_VERSION } from './types.js';

const nullableString = { type: ['string', 'null'] } as const;

// Fields every version of a row may carry (the per-row facts, never a session constant).
const ROW_PROPERTIES = {
  doc_type: { const: STAGE_EVIDENCE_DOC_TYPE },
  kind: { enum: ['open', 'stage_start', 'stage_end', 'verify', 'close'] },
  session_id: { type: 'string', minLength: 1 },
  conversation_ordinal: { type: 'integer', minimum: 1 },
  ts: { type: 'string', minLength: 1 },

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
  // Which agent produced this row (issue #573): `orchestrator` when the main chat wrote
  // it, or the dispatched stage agent's name (`paqad-development`). REQUIRED, because the
  // single write chokepoint (`appendFeatureStageRow`) always supplies it, so a row that
  // reaches validation without one is a script bug, not a legacy row. Reads never run this
  // validator (`readUnitFile` -> `readJsonl`), so rows written before #573 stay readable.
  agent: { type: 'string', minLength: 1 },
  // Where the row's session id came from (issue #582): a hook payload (`host`), the
  // flag/environment (`env`), or the shared cache file (`cache`). Optional and nullable,
  // so rows written before it existed still validate; a `cache` row never counts as an
  // edit made this turn by the completion check.
  session_source: { type: ['string', 'null'], enum: ['host', 'env', 'cache', null] },
  note: nullableString,
  content_hash: { type: 'string', minLength: 1 },
} as const;

/**
 * The current row shape (schema version 2, issue #581). A row carries only what changes per
 * row: the session constants (`adapter`, `branch`, `lane`) live once, on `feature.json`,
 * so the schema rejects them here (AC-6).
 */
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
    'agent',
    'content_hash',
  ],
  properties: {
    schema_version: { type: 'integer', const: STAGE_EVIDENCE_SCHEMA_VERSION },
    ...ROW_PROPERTIES,
  },
} as const;

/**
 * The pre-#581 row shape (schema version 1): every row stamped the `adapter`, and the open
 * row the `lane` and `branch` (issue #404). Kept so an old row still validates (INV-8);
 * no writer produces it any more (INV-9).
 */
export const STAGE_EVIDENCE_SCHEMA_V1 = {
  $id: 'paqad://schemas/stage-evidence-v1.json',
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
    'agent',
    'content_hash',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    ...ROW_PROPERTIES,
    adapter: { type: 'string', minLength: 1 },
    lane: { type: ['string', 'null'], enum: ['fast', 'graduated', 'full', null] },
    branch: nullableString,
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: { current: ValidateFunction; v1: ValidateFunction } | undefined;

/** The validator for a row's own version: a v1 row is judged by the v1 shape, else current. */
function validator(row: unknown): ValidateFunction {
  compiled ??= {
    current: ajv.compile(STAGE_EVIDENCE_SCHEMA),
    v1: ajv.compile(STAGE_EVIDENCE_SCHEMA_V1),
  };
  const version = (row as { schema_version?: unknown } | null)?.schema_version;
  return version === 1 ? compiled.v1 : compiled.current;
}

/** One human-readable line for a validation error. Exported so the fallback arms
 *  (root-level path, ajv omitting a message) stay directly testable. */
export function formatValidationError(error: { instancePath?: string; message?: string }): string {
  return `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`;
}

/** Returns `[]` when the row is a valid `paqad.stage-evidence` row, else error strings. */
export function validateStageEvidenceRow(row: unknown): string[] {
  const validate = validator(row);
  if (validate(row)) {
    return [];
  }
  // ajv's contract: a false return always populates `errors` — no fallback branch.
  const errors = validate.errors as NonNullable<typeof validate.errors>;
  return errors.map(formatValidationError);
}
