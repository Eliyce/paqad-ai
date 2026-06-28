// AJV schema for `paqad.decision-reuse` rows. Framework-owned, lives in src/ (never
// under .paqad/), so the LLM can never weaken it. Every recorded row is validated
// against this before it is appended.

import Ajv, { type ValidateFunction } from 'ajv';

import { DECISION_REUSE_DOC_TYPE } from './types.js';

const nullableString = { type: ['string', 'null'] } as const;

export const DECISION_REUSE_SCHEMA = {
  $id: 'paqad://schemas/decision-reuse.json',
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
    doc_type: { const: DECISION_REUSE_DOC_TYPE },
    kind: { enum: ['open', 'reuse'] },
    session_id: { type: 'string', minLength: 1 },
    conversation_ordinal: { type: 'integer', minimum: 1 },
    ts: { type: 'string', minLength: 1 },
    adapter: { type: 'string', minLength: 1 },

    decision_id: nullableString,
    category: nullableString,
    chosen_option_key: nullableString,
    match_kind: { type: ['string', 'null'], enum: ['exact', 'fingerprint', null] },
    source_path: nullableString,
    note: nullableString,
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    compiled = ajv.compile(DECISION_REUSE_SCHEMA);
  }
  return compiled;
}

/** Returns `[]` when the row is a valid `paqad.decision-reuse` row, else error strings. */
export function validateDecisionReuseRow(row: unknown): string[] {
  const validate = validator();
  if (validate(row)) {
    return [];
  }
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`,
  );
}
