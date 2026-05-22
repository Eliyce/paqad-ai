# Fix Proposal Template

When the verifier reports a failing test, every proposed fix must include the following fields. The template enforces evidence-anchored proposals — no speculation without anchors.

## Required fields per failure

```markdown
### Failure {N} — {failures[N].test_id}

- **AC:** {failures[N].ac_id or "untraced"}
- **Failure category:** {test-failure | test-error | test-timeout | gate-failure}
- **Anchor:** {failures[N].file}:{failures[N].line}
- **Observed vs expected:** {failures[N].message} (excerpt)
- **Root cause hypothesis:** one sentence on what is wrong, citing a specific file:line in the implementation under review
- **Proposed fix:** one short paragraph naming the file(s) to edit and the change to make. Do not paste full diffs; describe the smallest change that would make the test pass.
- **Risk if applied:** one sentence on what else this change could break (regression risk, performance, contract).
- **Confidence:** `high` | `medium` | `low`. Use `low` when the failure category is `test-error` (the test itself crashed) or when the root-cause cites a file not in the change set.
```

## Confidence calibration

- **`high`** — the failure is `test-failure` (assertion mismatch), the AC is known, the implementation file is in the change set, and the proposed fix is a one-line change.
- **`medium`** — the failure is `test-failure`, but the proposed fix touches multiple files or the AC is untraced.
- **`low`** — the failure is `test-error` or `test-timeout`, the implementation file is not in the change set, or the root-cause requires inspecting code outside the diff.

When confidence is `low`, the proposal must end with `Recommend: defer to human` and not be auto-applied.

## What never goes in a proposal

- Speculation without a file:line anchor.
- Multi-failure rewrites bundled into one proposal.
- Suggestions to weaken or delete the test.
- Suggestions to add a try/catch that swallows the failure.
