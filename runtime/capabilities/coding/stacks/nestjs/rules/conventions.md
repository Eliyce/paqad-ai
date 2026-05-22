# NestJS Conventions

- Keep modules cohesive: controller, service, DTOs, and entities should live together by feature.
- Validate all request and message payloads with pipes or schema validation before business logic runs.
- Treat guards as authorization boundaries, not just authentication wrappers.
- Keep interceptors and exception filters reusable and avoid leaking entity internals directly from controllers.
