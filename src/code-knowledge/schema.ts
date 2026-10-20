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
  errors: string[];
}

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
