import { describe, expect, it } from 'vitest';

import { SchemaValidator } from '@/validators';

describe('api-endpoint-doc schema', () => {
  const validator = new SchemaValidator();

  it('passes with valid endpoint doc', () => {
    const valid = {
      method: 'POST',
      route: '/api/v1/users',
      auth: 'required',
      permissions: ['users.create'],
      description: 'Creates a new user',
      request_schema_ref: 'CreateUserRequest',
      response_schema_ref: 'UserResponse',
      error_codes_ref: 'USR-001, USR-002',
      added_in: '01-create-user',
      last_updated: '2026-03-16',
    };
    const result = validator.validate('api-endpoint-doc', valid);
    expect(result.valid).toBe(true);
  });

  it('fails with invalid HTTP method', () => {
    const invalid = {
      method: 'FETCH',
      route: '/api/v1/users',
      auth: 'required',
      description: 'Creates a new user',
      request_schema_ref: 'ref',
      response_schema_ref: 'ref',
    };
    const result = validator.validate('api-endpoint-doc', invalid);
    expect(result.valid).toBe(false);
  });

  it('fails when route does not start with /', () => {
    const invalid = {
      method: 'GET',
      route: 'api/users',
      auth: 'public',
      description: 'Lists users',
      request_schema_ref: 'ref',
      response_schema_ref: 'ref',
    };
    const result = validator.validate('api-endpoint-doc', invalid);
    expect(result.valid).toBe(false);
  });
});
