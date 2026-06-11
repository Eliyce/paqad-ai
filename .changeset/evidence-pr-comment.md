---
'paqad-ai': minor
---

`paqad-ai evidence` — render verification evidence as a scannable PR comment (#119).

paqad already computes a fully-typed `VerificationEvidence` per run (per-gate
pass/fail, mutation kill-rate + confidence, test failures with `file:line`) and
persists it to `.paqad/session/verification-evidence.json` — but nothing ever
rendered it for a human. The new read-only command turns that JSON into a short
green/red markdown summary you can pipe straight to `gh pr comment`:

```
paqad-ai evidence $(git rev-parse HEAD) --output evidence.md \
  && gh pr comment --body-file evidence.md
```

- Headline is driven by `overall_status` (🟢 Safe to merge / 🔴 Needs your
  attention), with the three trust-bearing gates (tests, mutation, quality
  ratchet) surfaced verbatim and every blocking failure pinned to `file:line`.
- Numbers are rendered straight off each gate's `detail` string, so the comment
  never claims a figure the evidence does not hold. Lower-confidence mutation
  results are flagged, never hidden.
- The footer honestly attests "paqad's gates passed for this run, not that the
  change is correct" — the human-readable counterpart to the signed receipt
  from #118, not a replacement for it.
- `--format json` re-emits the evidence, `--output <path>` writes a file, and
  `--fail-on-red` exits non-zero in CI when the overall status is fail.

Output is deterministic: identical evidence yields a byte-identical comment.
The command computes nothing, gates nothing, and signs nothing — it only
surfaces what verification already produced.

**Auto-post for every onboarded project.** The same render is now posted to
the PR automatically by the delivery CI gate (#42), so the proof lands without
anyone running a command. The provider-neutral `HostProvider` contract gains a
`comment()` capability (GitHub adapter: `gh pr comment`), completing the
previously half-built `on_red: comment_and_stop` intent. The gate posts the
evidence on green (the "safe to merge" proof) and on a `comment_and_stop` red
(the proof of what blocked it). Posting is best-effort — a failed comment never
changes the gate verdict — and self-disables when no evidence exists.
