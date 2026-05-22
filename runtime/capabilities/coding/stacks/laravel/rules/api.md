# Laravel API

- Keep controllers thin and move domain work into actions, services, or jobs.
- Use Form Request classes for write validation and policies/gates for authorization.
- Return API resources or explicit DTO-style payloads; do not leak raw model internals.
- Paginate list endpoints and use allow-lists for filtering and sorting inputs.
- Document changed endpoints, schemas, and error codes under `docs/modules/<module>/api/`.
