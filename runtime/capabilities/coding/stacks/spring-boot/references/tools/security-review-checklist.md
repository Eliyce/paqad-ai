# Spring Boot Security Review Checklist

- Validate Spring Security `@PreAuthorize` or `SecurityFilterChain` rules on all protected endpoints.
- Check for method-level security on service beans that are reachable from public APIs.
- Review `application.properties` / `application.yml` for exposed actuator endpoints and management port exposure.
- Confirm secrets are injected via environment variables or a secrets manager, not committed to config files.
- Review CORS configuration: ensure allowed origins are explicitly listed and not wildcarded in production.
