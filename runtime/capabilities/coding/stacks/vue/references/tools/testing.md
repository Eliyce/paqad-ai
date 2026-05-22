# Vue Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the broader gate before merge.

## Common Commands

- focused test file: `pnpm test -- <path-or-pattern>`
- full suite: `pnpm test`
- lint: `pnpm lint`
- typecheck: `pnpm run typecheck`
- if Docker Compose is active, run these through the matching `docker compose exec <node-service>` wrapper

## Coverage Expectations

- cover happy path plus blocked, empty, or error states that changed
- add browser coverage for route-level behavior when it materially changed
