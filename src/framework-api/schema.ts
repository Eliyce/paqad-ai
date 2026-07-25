// AJV validation for the framework-API index (issue #397). Same discipline as the
// code-knowledge index (issue #353): the committed JSON schema lives in
// src/validators/schemas/ so it is packaged into dist and can never be weakened from a
// project, and the build validates before persisting, so a malformed index fails loudly
// rather than shipping a shape a consumer would mis-read (INV-4).

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
  /** Human-readable `<path> <message>` lines; empty when valid. */
  errors: string[];
}

/** Validate a value against the committed framework-API schema. */
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
