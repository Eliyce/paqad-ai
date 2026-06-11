---
'paqad-ai': minor
---

Make the verification gates bind (#117). The existing gate runner now fires
automatically from a completion hook and a git/CI backstop via a new exported
`runRepositoryVerification` API, against repository reality, with the judgment
inputs computed instead of stubbed:

- C-1: agent-independent verification entry point + non-provider origins
  (`hook-completion`, `git-backstop`, `ci-backstop`); completion (`Stop`) hook,
  git pre-commit hook, and CI backstop script.
- C-2: `ac-test-mapping`, `implementation-review`, and `spec-review` computed
  from the traceability map, decision store, and spec-review reports; signals
  that need model judgment escalate as inconclusive instead of passing vacuously.
- C-3: a decision-pause PreToolUse hook that blocks mutating tools while a
  decision packet is unresolved.
- C-4: scope-drift in the `change-completeness` gate against the derived spec
  boundary, naming the out-of-scope paths.
- C-5: the live hooks are generated for hook-capable adapters from one
  definition, with a documented per-adapter coverage matrix.
- C-6: one machine-readable trust verdict, streamed as a `verification-verdict`
  engine event and written to the verification-evidence artifact.

No new CLI verb. See `docs/verification-enforcement.md` for the enforcement
boundary and limitations.
