import Ajv, { type ValidateFunction } from 'ajv';

import frameworkApiSchema from '../validators/schemas/framework-api.schema.json';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    compiled = ajv.compile(frameworkApiSchema);
  }
  return compiled;
}

export interface FrameworkApiValidation {
  valid: boolean;
  errors: string[];
}

export function validateFrameworkApiIndex(data: unknown): FrameworkApiValidation {
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
