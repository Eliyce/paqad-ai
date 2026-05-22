# React Security Review Checklist

- Validate route protection and server/client boundary handling for sensitive flows.
- Check bundle-exposed config, debug routes, and local runtime surfaces.
- Review auth-sensitive module docs against negative-path and boundary-focused tests.
- Confirm secrets and server-only logic do not leak into client bundles.
