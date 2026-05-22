import { describe, expect, it } from 'vitest';

import { SchemaValidator } from '@/validators';

describe('integration-doc schema', () => {
  const validator = new SchemaValidator();

  it('passes with valid integration event', () => {
    const valid = {
      event_class: 'App\\Events\\UserCreated',
      published_by: 'UserService::create()',
      payload_fields: [{ name: 'user_id', type: 'integer', description: 'ID of created user' }],
      subscribers: ['NotificationModule', 'AnalyticsModule'],
      async: true,
      added_in: '01-create-user',
    };
    const result = validator.validate('integration-doc', valid);
    expect(result.valid).toBe(true);
  });

  it('fails when event_class is empty', () => {
    const invalid = {
      event_class: '',
      published_by: 'SomeService',
      subscribers: [],
      async: false,
    };
    const result = validator.validate('integration-doc', invalid);
    expect(result.valid).toBe(false);
  });
});
