// AJV validation for the code-knowledge index (issue #353). Framework-owned; the
// committed JSON schema lives in src/validators/schemas/ so it is packaged into
// dist and can never be weakened from a project. `index build` validates the
// index it just built before persisting, so a malformed index fails loudly (AC-1)
// rather than shipping a shape a consumer would mis-read.

import Ajv, { type ValidateFunction } from 'ajv';

import codeKnowledgeSchema from '../validators/schemas/code-knowledge.schema.json';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    compiled = ajv.compile(codeKnowledgeSchema);
  }
  return compiled;
}

export interface CodeKnowledgeValidation {
  valid: boolean;
  /** Human-readable `<path> <message>` lines; empty when valid. */
  errors: string[];
}

/** Validate a value against the committed code-knowledge schema. */
export function validateCodeKnowledgeIndex(data: unknown): CodeKnowledgeValidation {
  const validate = validator();
  if (validate(data)) {
    return { valid: true, errors: [] };
  }
  /* v8 ignore next -- ajv always populates errors[] after a failed validate */
  const rawErrors = validate.errors ?? [];
  const errors = rawErrors.map((error) => {
    const path = error.instancePath.length > 0 ? error.instancePath : '/';
    /* v8 ignore next -- ajv always sets a message under the default options */
    const message = error.message ?? 'invalid';
    return `${path} ${message}`.trim();
  });
  return { valid: false, errors };
}
