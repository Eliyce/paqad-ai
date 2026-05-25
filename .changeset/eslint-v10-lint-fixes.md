---
'paqad-ai': patch
---

Internal code-quality cleanup: remove 13 dead-store assignments flagged by `@eslint/js` v10's `no-useless-assignment` rule, and attach the original error as `cause` when wrapping decision-pause write failures so callers can inspect the underlying I/O error via `error.cause`.
