# FastAPI Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands

- focused test: `pytest -k "<pattern>"`
- full suite: `pytest`
- lint: `ruff check .`
- typecheck: `mypy .` (if configured)
- if Docker Compose is active, prefix with `docker compose exec <python-service>`

## Coverage Expectations

- cover happy path plus validation error, auth-required, and 422 response states that changed
- include dependency-injection override tests for new route handlers
