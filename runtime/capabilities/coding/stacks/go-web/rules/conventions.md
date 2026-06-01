# Go Web Conventions

- Run `gofmt`/`goimports` and `go vet` clean before committing; do not hand-format or leave `go vet` complaints unaddressed.
- Return errors as the last return value and check them at the call site; do not discard with `_` unless the error is provably irrelevant, and never `panic` for ordinary control flow.
- Wrap errors with context using `fmt.Errorf("...: %w", err)` so callers can `errors.Is`/`errors.As`; do not build error chains by string concatenation.
- Pass `context.Context` as the first parameter (named `ctx`) to every function doing I/O or that can be cancelled; do not store a `Context` in a struct field.
- Name exported identifiers in `MixedCaps` (no underscores) and keep package names short, lowercase, and singular; avoid stutter like `http.HTTPServer`.
- Guard shared mutable state accessed from multiple goroutines with a `sync.Mutex`/`sync.RWMutex` or channels; run the race detector (`go test -race`) on concurrent code.
- Start a goroutine only with a clear stop condition — derive cancellation from `ctx` or a done channel; do not spawn goroutines that can outlive the request without a way to halt them.
- Use the standard `log/slog` for structured logging rather than `fmt.Println`; do not log secrets or full request bodies.
