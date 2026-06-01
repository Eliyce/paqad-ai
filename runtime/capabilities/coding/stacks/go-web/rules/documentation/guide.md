# Go Web Documentation

- Write doc comments on every exported identifier (package, type, func, const), starting with the identifier's name (`// Server runs ...`) so `go doc` and `pkg.go.dev` render them correctly.
- Give each package a package comment (one `// Package <name> ...` block, conventionally in `doc.go` or the primary file) describing its responsibility.
- Document the contract a caller must satisfy: which errors a function returns, whether a value is safe for concurrent use, and ownership of any returned resource that must be closed.
- Document context-cancellation and timeout behavior for handlers and clients when it is non-obvious (e.g. "respects ctx deadline; returns context.DeadlineExceeded").
- Keep `README.md` build/run commands (`go build ./...`, `go run ./cmd/...`, required Go version in `go.mod`) accurate and runnable.
