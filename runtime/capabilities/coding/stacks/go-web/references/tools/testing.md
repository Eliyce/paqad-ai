# Go Web Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands

- focused test: `go test ./... -run "<pattern>"`
- full suite: `go test ./...`
- lint: `go vet ./...`
- format check: `gofmt -l .`
- if Docker Compose is active, prefix with `docker compose exec <go-service>`

## Coverage Expectations

- cover happy path plus unauthorized, not-found, and input-validation error paths that changed
- use `httptest.NewRecorder` for HTTP handler unit tests; keep integration tests in `_test` packages
