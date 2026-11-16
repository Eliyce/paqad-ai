# Code Quality

How the code you add should read and behave. Loads for code changes.

<!-- trigger: ** -->

- Match the surrounding code's style, naming, and structure, and read the neighboring files before you add a new one. <!-- @rule RL-f823 -->
- Keep each function small and single-purpose, and add an abstraction only when the current change needs it. <!-- @rule RL-067e -->
- Handle errors explicitly and propagate them with context. MUST NOT swallow an error in an empty `catch`. <!-- @rule RL-de1b -->
- Remove any dead code, commented-out block, or unused import you introduce. <!-- @rule RL-e3e4 -->
- Resolve every shared value (filesystem path, runtime or package root, config, client) through its one canonical helper; if none exists, add one and route all callers through it. MUST NOT hand-copy or re-derive that logic locally. A divergent copy ships a silent bug. Grep for an existing resolver before you write a new one. <!-- @rule RL-3210 -->
- Surface a failed lookup as an error. MUST NOT return a guessed default or treat an empty result as success when results were expected. <!-- @rule RL-2b5e -->

## Verify

```bash
# Dead code and unused imports are caught by the linter:
pnpm lint
# Candidate duplicate root/path derivations to route through a helper (review each hit):
git grep -nE '(os\.homedir\(\)|process\.cwd\(\)|__dirname)' -- 'src/**/*.ts'
```
- An error thrown inside a catch block, including the project's custom Error subclasses, passes the caught error as `cause`, and `preserve-caught-error` lists those subclasses in `errorClassNames`. <!-- @rule RL-0d9b discovered:rd-20261116-061901 -->
- After YAML.parseDocument() on file content, doc.errors is checked before the document's contents are read, edited or written back. <!-- @rule RL-18e7 discovered:rd-20261116-061901 -->
