# Angular Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands

- focused test: `pnpm test -- --include="<pattern>"`
- full suite: `pnpm test`
- lint: `pnpm lint`
- typecheck: `pnpm run typecheck`
- if Docker Compose is active, prefix with `docker compose exec <node-service>`

## Coverage Expectations

- cover happy path plus empty-state, error-state, and auth-guard-blocked routes that changed
- use `TestBed` component tests for new components and service-level unit tests for business logic
