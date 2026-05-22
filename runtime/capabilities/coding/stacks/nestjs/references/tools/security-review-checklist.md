# NestJS Security Review Checklist

- Verify `ValidationPipe` coverage for HTTP and message inputs.
- Confirm sensitive endpoints use resource-aware guards, not authentication-only checks.
- Review DTOs and serializers to avoid internal field exposure.
- Add depth and complexity limits when GraphQL is active.
