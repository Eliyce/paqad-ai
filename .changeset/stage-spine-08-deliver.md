---
'paqad-ai': minor
---

Stage-Spine 08 (#323): ship `paqad-ai deliver` — wire the dead delivery engine and close the CI loop.

The ~1,900-line delivery engine (branch/commit/PR + CI wait-for-green + on-red-stop + evidence
comment) had no invocation path. `paqad-ai deliver` now runs the tested chain end-to-end:

- `--dry-run` renders the branch/commit/PR text without pushing.
- The real path asks first via a mandatory `delivery.open_pr` Decision Packet (opening a PR is
  outward-facing and hard to reverse), then runs `renderDelivery → runDelivery → runCiGate`,
  waits for CI (`wait_for_green` / `on_red: stop`), stops with a clear reason on red (never a
  false success), and posts the rendered verification evidence to the PR on green.
- Reuses `src/delivery/*` — no hand-rolled git/gh flow.

Also fixes the delivery-policy evidence instruction that promised an auto-posted comment that
never happened: it now names `paqad-ai deliver` (auto-posts on green) plus the manual
`paqad-ai evidence --output … && gh pr comment --body-file …` fallback.

Deferred (follow-ups): a Bash `PreToolUse` deny of hand-rolled `gh pr create` / `git push` while
a `delivery.open_pr` packet is pending (the pause is already enforced by the verb), and adding a
delivery block to this repo's `feature-development.yaml` + having `paqad-ai update` append missing
default blocks (ties to #12).
