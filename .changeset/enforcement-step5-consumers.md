---
'paqad-ai': minor
---

Wire the last three enforcement consumers so the framework is felt, not just recorded (enforcement RCA, part 2 of the fix).

Building on the stage writer and block-forward deny, three contracts that shipped with a policy but no live consumer now bind through the kernel:

- **Delivery policy is enforced.** A `delivery` capability at the completion (Stop) seam reads HEAD branch/commit and — when `gh` can answer — the PR/CI state, then **warns** on a convention deviation (on the base branch, an off-convention branch name, red CI under `wait_for_green`) and appends a `delivery-evidence` row. Warn-floor by design: delivery is `mandatory:false`, so it surfaces a bad push one turn late but never blocks. Degrades cleanly when `gh` is absent.
- **The stage is printed on entry.** The stage-writer PreToolUse hook now prints a plain-English `▸ paqad · <stage>` line (via Claude's user-visible `systemMessage` channel) the first time a change enters each stage, so the developer sees the workflow running even when the model forgets to say it. Claude-only (the sole pre-mutation host); idempotent per change.
- **The Decision Pause Contract self-arms.** An opt-in pre-mutation capability reads the recent prompt from the turn transcript and, on a high-confidence create-vs-reuse fork with no decision pending or already made, mints ONE pending decision packet so the existing decision-pause gate blocks the _next_ edit — closing the "nothing mints the packet" gap. **Off by default** (enable with `PAQAD_DECISION_SELFARM` or a local `.config` `decision_selfarm` line); it only mints, never blocks, so the current edit is never interrupted.

The kernel gate now threads an optional tool/turn payload (edit target, transcript path, session id) to each capability; every existing capability ignores it. Coverage stays at the 95% branch gate.
