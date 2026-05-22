import { validateApiDoc } from '@/validators';

describe('validateApiDoc', () => {
  it('accepts valid api docs', () => {
    expect(
      validateApiDoc(
        `## Endpoints
### GET /users

| Field | Value |
|-------|-------|
| **Method** | GET |
| **Route** | /users |
| **Auth** | Required |
| **Description** | Lists users |
| **Request Schema** | UserIndexRequest |
| **Response Schema** | UserCollection |`,
      ).valid,
    ).toBe(true);
  });

  it('rejects invalid api docs', () => {
    expect(validateApiDoc('# Missing').valid).toBe(false);
  });
});
