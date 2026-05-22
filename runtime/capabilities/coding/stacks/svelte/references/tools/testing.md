# Svelte Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands

- focused test: `pnpm test -- <path-or-pattern>`
- full suite: `pnpm test`
- lint: `pnpm lint`
- typecheck: `pnpm run typecheck`
- if Docker Compose is active, prefix with `docker compose exec <node-service>`

## Coverage Expectations

- cover happy path plus empty-state, error-boundary, and auth-blocked states that changed
- include component tests with `@testing-library/svelte` for user-interaction flows
