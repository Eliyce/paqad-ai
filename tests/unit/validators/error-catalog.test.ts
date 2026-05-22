import { describe, expect, it } from 'vitest';

import { SchemaValidator } from '@/validators';

describe('error-catalog schema', () => {
  const validator = new SchemaValidator();

  it('passes with valid error entry', () => {
    const valid = {
      code: 'USR-001',
      http_status: 422,
      user_message: 'Email already registered',
      internal_message: 'Duplicate email constraint violation',
      trigger: 'Duplicate email on registration',
      recovery_path: 'Show error, suggest login',
      retry_safe: false,
      logged: true,
      alerted: false,
      added_in: '02-registration-validation',
      last_updated: '2026-03-16',
    };
    const result = validator.validate('error-catalog', valid);
    expect(result.valid).toBe(true);
  });

  it('fails with invalid error code format', () => {
    const invalid = {
      code: 'user-1',
      user_message: 'Error',
      trigger: 'Something',
      recovery_path: 'Retry',
      retry_safe: true,
    };
    const result = validator.validate('error-catalog', invalid);
    expect(result.valid).toBe(false);
  });

  it('fails when recovery_path is empty', () => {
    const invalid = {
      code: 'USR-001',
      user_message: 'Error occurred',
      trigger: 'Bad input',
      recovery_path: '',
      retry_safe: false,
    };
    const result = validator.validate('error-catalog', invalid);
    expect(result.valid).toBe(false);
  });
});
