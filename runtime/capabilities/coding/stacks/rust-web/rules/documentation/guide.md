# Rust Web Documentation

- Write `///` doc comments on public items (types, traits, functions, modules) and a `//!` crate/module-level comment summarizing each module's responsibility; these render on docs.rs and via `cargo doc`.
- Document what each public function returns on error (which `Err` variants) and any panics it can produce with a `# Panics` section; if it cannot panic on valid input, prefer returning `Result` over documenting a panic.
- Add `# Safety` sections to every public `unsafe fn`, stating the invariants the caller must uphold, and `// SAFETY:` comments on `unsafe` blocks.
- Include runnable doc examples (` ```rust `) for non-trivial public APIs; they are compiled and tested by `cargo test`, so keep them correct.
- Note async cancellation behavior when relevant (whether a future is cancel-safe across `.await` points), and keep `README.md` build/run commands (`cargo build`, `cargo run`, MSRV) accurate.
