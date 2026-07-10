# Code Quality

How the code you add should read and behave. Loads for code changes.

<!-- trigger: ** -->

- Match the surrounding code's style, naming, and structure, and read the neighboring files before you add a new one.
- Keep each function small and single-purpose, and add an abstraction only when the current change needs it.
- Handle errors explicitly and propagate them with context. MUST NOT swallow an error in an empty `catch`.
- Remove any dead code, commented-out block, or unused import you introduce.
- Resolve every shared value (filesystem path, runtime or package root, config, client) through its one canonical helper; if none exists, add one and route all callers through it. MUST NOT hand-copy or re-derive that logic locally. A divergent copy ships a silent bug. Grep for an existing resolver before you write a new one.
- Surface a failed lookup as an error. MUST NOT return a guessed default or treat an empty result as success when results were expected.

## Verify

```bash
# Dead code and unused imports are caught by the linter:
pnpm lint
# Candidate duplicate root/path derivations to route through a helper (review each hit):
git grep -nE '(os\.homedir\(\)|process\.cwd\(\)|__dirname)' -- 'src/**/*.ts'
```
