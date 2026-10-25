import Ajv, { type ValidateFunction } from 'ajv';

import { STAGE_EFFORT_LEVELS, STAGE_MODELS } from '@/core/framework-config.js';
import { ENVELOPE_HEADER_PROPERTIES } from '@/feature-evidence/schema.js';

import {
  COMPLETION_DEFERRED_KIND,
  RECORD_REPAIR_KIND,
  SPEC_CORRECTION_KIND,
  SPEC_STEP_KIND,
  SPEC_STEP_OUTCOMES,
  STAGE_AGENT_KIND,
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  STAGE_FAMILY_KIND_LIST,
} from './types.js';

const nullableString = { type: ['string', 'null'] } as const;

const ROW_PROPERTIES = {
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
  agent: { type: 'string', minLength: 1 },
  session_source: { type: ['string', 'null'], enum: ['host', 'env', 'cache', null] },
  note: nullableString,
} as const;

export const STAGE_EVIDENCE_SCHEMA = {
  $id: 'paqad://schemas/stage-evidence.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'change',
    'session_id',
    'recorded_at',
    'content_hash',
    'kind',
    'agent',
  ],
  properties: {
    ...ENVELOPE_HEADER_PROPERTIES,
    schema_version: { type: 'integer', const: STAGE_EVIDENCE_SCHEMA_VERSION },
    doc_type: { const: STAGE_EVIDENCE_DOC_TYPE },
    kind: {
      enum: [
        ...STAGE_FAMILY_KIND_LIST,
        STAGE_AGENT_KIND,
        SPEC_STEP_KIND,
        SPEC_CORRECTION_KIND,
        COMPLETION_DEFERRED_KIND,
        RECORD_REPAIR_KIND,
      ],
    },
    ...ROW_PROPERTIES,
    reason: { type: 'string', minLength: 1 },
    tasks: { type: 'integer', minimum: 0 },
    tokens_used: { type: 'integer', minimum: 0 },
    tokens_not_recarried: { type: 'integer', minimum: 0 },
    estimate: { type: 'boolean' },
    requested_effort: { enum: STAGE_EFFORT_LEVELS },
    requested_model: { enum: STAGE_MODELS },
    step: { type: 'string', minLength: 1 },
    outcome: { enum: SPEC_STEP_OUTCOMES },
    artifact_hash: { type: 'string' },
    tokens: { type: 'integer', minimum: 0 },
    spec_id: { type: 'string', minLength: 1 },
    changed_sections: { type: 'array', items: { type: 'string' } },
  },
  allOf: [
    {
      if: { properties: { kind: { const: STAGE_AGENT_KIND } }, required: ['kind'] },
      then: { required: ['stage', 'tokens_used', 'tokens_not_recarried', 'estimate'] },
    },
    {
      if: { properties: { kind: { const: SPEC_STEP_KIND } }, required: ['kind'] },
      then: { required: ['step', 'outcome', 'artifact_hash'] },
    },
    {
      if: { properties: { kind: { const: SPEC_CORRECTION_KIND } }, required: ['kind'] },
      then: { required: ['spec_id', 'changed_sections'] },
    },
    {
      if: { properties: { kind: { const: COMPLETION_DEFERRED_KIND } }, required: ['kind'] },
      then: { required: ['reason', 'tasks'] },
    },
    {
      if: { properties: { kind: { const: RECORD_REPAIR_KIND } }, required: ['kind'] },
      then: { required: ['reason'] },
    },
  ],
} as const;

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
    doc_type: { const: STAGE_EVIDENCE_DOC_TYPE },
    session_id: { type: 'string', minLength: 1 },
    conversation_ordinal: { type: 'integer', minimum: 1 },
    ts: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },
    kind: { enum: STAGE_FAMILY_KIND_LIST },
    ...ROW_PROPERTIES,
    adapter: { type: 'string', minLength: 1 },
    lane: { type: ['string', 'null'], enum: ['fast', 'graduated', 'full', null] },
    branch: nullableString,
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: { current: ValidateFunction; v1: ValidateFunction } | undefined;

function validator(row: unknown): ValidateFunction {
  compiled ??= {
    current: ajv.compile(STAGE_EVIDENCE_SCHEMA),
    v1: ajv.compile(STAGE_EVIDENCE_SCHEMA_V1),
  };
  const version = (row as { schema_version?: unknown } | null)?.schema_version;
  return version === 1 ? compiled.v1 : compiled.current;
}

export function formatValidationError(error: { instancePath?: string; message?: string }): string {
  return `${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`;
}

export function validateStageEvidenceRow(row: unknown): string[] {
  const validate = validator(row);
  if (validate(row)) {
    return [];
  }
  const errors = validate.errors as NonNullable<typeof validate.errors>;
  return errors.map(formatValidationError);
}
