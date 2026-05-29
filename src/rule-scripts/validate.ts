// ajv-backed validation for the rule-script header + findings contracts
// (issue #89). Self-contained within the module so the runtime engine does not
// depend on the project-artifact SchemaValidator.

import Ajv, { type ValidateFunction } from 'ajv';

import findingsSchema from './schemas/findings.schema.json';
import headerSchema from './schemas/script-header.schema.json';

const ajv = new Ajv({ allErrors: true });

let headerValidator: ValidateFunction | null = null;
let findingsValidator: ValidateFunction | null = null;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function run(validator: ValidateFunction, data: unknown): ValidationResult {
  const valid = validator(data) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validator.errors ?? []).map((e) =>
    `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`.trim(),
  );
  return { valid: false, errors };
}

export function validateScriptHeader(header: unknown): ValidationResult {
  headerValidator ??= ajv.compile(headerSchema);
  return run(headerValidator, header);
}

export function validateFindings(report: unknown): ValidationResult {
  findingsValidator ??= ajv.compile(findingsSchema);
  return run(findingsValidator, report);
}
