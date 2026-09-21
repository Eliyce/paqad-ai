// AJV schema for `paqad.context-efficiency` rows (issue #567). Framework-owned, lives in
// src/ (never under .paqad/), so the LLM can never weaken it. One row per dispatched stage
// agent: the tokens it consumed and the carried history the orchestrator did not re-send.
// Validated before it is appended, exactly like the stage-evidence rows.

import Ajv, { type ValidateFunction } from 'ajv';

import { formatValidationError } from '@/stage-evidence/schema.js';

/** Doc type stamped on a per-feature `context-efficiency.jsonl` row. */
export const CONTEXT_EFFICIENCY_DOC_TYPE = 'paqad.context-efficiency';
export const CONTEXT_EFFICIENCY_SCHEMA_VERSION = 1;

export const CONTEXT_EFFICIENCY_SCHEMA = {
  $id: 'paqad://schemas/context-efficiency.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'doc_type',
    'session_id',
    'ts',
    'content_hash',
    'stage',
    'agent_id',
    'adapter',
    'orchestrator_session_id',
    'tokens_input',
    'tokens_cached',
    'tokens_output',
    'exact',
    'carried_history_avoided_estimate',
  ],
  properties: {
    schema_version: { type: 'integer', const: CONTEXT_EFFICIENCY_SCHEMA_VERSION },
    doc_type: { const: CONTEXT_EFFICIENCY_DOC_TYPE },
    session_id: { type: 'string', minLength: 1 },
    ts: { type: 'string', minLength: 1 },
    content_hash: { type: 'string', minLength: 1 },

    /** The feature-development stage this agent ran. */
    stage: { type: 'string', minLength: 1 },
    /** The host's id for the dispatched subagent. */
    agent_id: { type: 'string', minLength: 1 },
    adapter: { type: 'string', minLength: 1 },
    /** The orchestrator's session id — the one identity every row in the change shares. */
    orchestrator_session_id: { type: 'string', minLength: 1 },
    tokens_input: { type: 'integer', minimum: 0 },
    tokens_cached: { type: 'integer', minimum: 0 },
    tokens_output: { type: 'integer', minimum: 0 },
    /** true when the token counts came from host usage; false when estimated. */
    exact: { type: 'boolean' },
    /** Orchestrator transcript size at dispatch vs a single-context run — always an estimate. */
    carried_history_avoided_estimate: { type: 'integer', minimum: 0 },
  },
} as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    compiled = ajv.compile(CONTEXT_EFFICIENCY_SCHEMA);
  }
  return compiled;
}

/** Returns `[]` when the row is a valid `paqad.context-efficiency` row, else error strings. */
export function validateContextEfficiencyRow(row: unknown): string[] {
  const validate = validator();
  if (validate(row)) {
    return [];
  }
  const errors = validate.errors as NonNullable<typeof validate.errors>;
  return errors.map(formatValidationError);
}
