# Express Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands

- focused test: `pnpm test -- <path-or-pattern>`
- full suite: `pnpm test`
- lint: `pnpm lint`
- typecheck: `pnpm run typecheck` (if TypeScript)
- if Docker Compose is active, prefix with `docker compose exec <node-service>`

## Coverage Expectations

- cover happy path plus 401, 403, 404, and validation-error responses that changed
- include integration tests for middleware chains on new route groups
