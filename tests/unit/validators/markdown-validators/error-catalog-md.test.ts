import { validateErrorCatalogMarkdown } from '@/validators';

describe('validateErrorCatalogMarkdown', () => {
  it('accepts valid error catalog docs', () => {
    expect(
      validateErrorCatalogMarkdown(
        `# Errors
## Error Code Format
USR-001
## Errors
### USR-001: Duplicate Email

| Field | Value |
|-------|-------|
| **Code** | USR-001 |
| **User-Facing Message** | Email already registered |
| **Trigger** | Duplicate email |
| **Recovery Path** | Suggest login |`,
      ).valid,
    ).toBe(true);
  });

  it('rejects invalid error catalog docs', () => {
    expect(validateErrorCatalogMarkdown('# Errors').valid).toBe(false);
  });
});
