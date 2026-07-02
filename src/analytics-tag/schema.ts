// AJV schema for `paqad.analytics-tag` rows (issue #241). Framework-owned, lives in src/
// (never under .paqad/), so the LLM can never weaken it. Every recorded row is validated
// against this before it is appended. Strictness trap (same as rag-evidence): any new field
// must be added to BOTH the TS interface and this schema, or the row is rejected.

import Ajv, { type ValidateFunction } from 'ajv';

import { ANALYTICS_TAG_DOC_TYPE } from './types.js';

const nullableString = { type: ['string', 'null'] } as const;

export const ANALYTICS_TAG_SCHEMA = {
  $id: 'paqad://schemas/analytics-tag.json',
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
    doc_type: { const: ANALYTICS_TAG_DOC_TYPE },
    kind: { enum: ['open', 'tag_added'] },
    session_id: { type: 'string', minLength: 1 },
    conversation_ordinal: { type: 'integer', minimum: 1 },
    ts: { type: 'string', minLength: 1 },
    adapter: { type: 'string', minLength: 1 },

    tag_name: nullableString,
    tag_provider: nullableString,
    source_path: nullableString,

    note: nullableString,
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    compiled = ajv.compile(ANALYTICS_TAG_SCHEMA);
  }
  return compiled;
}

/** Returns `[]` when the row is a valid `paqad.analytics-tag` row, else error strings. */
export function validateAnalyticsTagRow(row: unknown): string[] {
  const validate = validator();
  if (validate(row)) {
    return [];
  }
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`,
  );
}
