// AJV schema for `paqad.rag-evidence` rows (issue #249 P1). Framework-owned, lives in
// src/ (never under .paqad/), so the LLM can never weaken it. Every recorded row is
// validated against this before it is appended.

import Ajv, { type ValidateFunction } from 'ajv';

import { RAG_EVIDENCE_DOC_TYPE } from './types.js';

const nullableInt = { type: ['integer', 'null'] } as const;
const nullableString = { type: ['string', 'null'] } as const;

export const RAG_EVIDENCE_SCHEMA = {
  $id: 'paqad://schemas/rag-evidence.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'kind',
    'session_id',
    'conversation_ordinal',
    'ts',
    'rag_enabled',
    'adapter',
    'content_hash',
  ],
  properties: {
    schema_version: { type: 'integer', const: 1 },
    doc_type: { const: RAG_EVIDENCE_DOC_TYPE },
    kind: { enum: ['open', 'refreshed', 'called', 'used', 'fallback', 'close'] },
    session_id: { type: 'string', minLength: 1 },
    conversation_ordinal: { type: 'integer', minimum: 1 },
    ts: { type: 'string', minLength: 1 },
    rag_enabled: { type: 'boolean' },
    adapter: { type: 'string', minLength: 1 },

    refresh_kind: {
      type: ['string', 'null'],
      enum: ['rebuild', 'incremental-sync', 'rule-context', 'vision', 'crs', 'attachment', null],
    },
    changed_files: nullableInt,
    chunks_embedded: nullableInt,
    chunks_cached: nullableInt,

    query_scope: { type: ['string', 'null'], enum: ['docs', 'code', 'all', null] },
    top_n: nullableInt,
    candidates: nullableInt,

    injected: { type: ['boolean', 'null'] },
    injected_sections: {
      type: ['array', 'null'],
      items: { enum: ['rules', 'memory', 'retrieval', 'drift'] },
    },
    slice_count: nullableInt,
    pointer_count: nullableInt,
    score_top: { type: ['number', 'null'] },
    bytes_injected: nullableInt,

    fallback_reason: {
      type: ['string', 'null'],
      enum: [
        'rag-disabled',
        'no-index',
        'cold',
        'below-floor',
        'provider-mismatch',
        'chunker-mismatch',
        'error',
        null,
      ],
    },

    chunker_version: nullableString,
    index_branch: nullableString,
    latency_ms: nullableInt,
    note: nullableString,
    content_hash: { type: 'string', minLength: 1 },
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    compiled = ajv.compile(RAG_EVIDENCE_SCHEMA);
  }
  return compiled;
}

/** Returns `[]` when the row is a valid `paqad.rag-evidence` row, else error strings. */
export function validateRagEvidenceRow(row: unknown): string[] {
  const validate = validator();
  if (validate(row)) {
    return [];
  }
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`,
  );
}
