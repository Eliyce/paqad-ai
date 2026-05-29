# Rule-editor sub-modes

One skill, four modes, all driven by the user's prompt. Each mutates exactly one rule; nothing else is recomputed (the no-global-rebuild guarantee).

## add — `add rule "<text>" to <rule-file>`

1. `edit-rule.mjs add <root> <source-rel> "<text>"` inserts the bullet and mints a fresh `RL-<hash>` id (collision-checked against the whole map + every on-disk marker).
2. Re-run `analyze rules` (idempotent) to classify the new rule and detect conflicts.
3. `generate rule scripts` with `only_rule_id` for the new id.

## edit — `edit rule RL-<id> to "<new text>"`

1. `edit-rule.mjs edit <root> RL-<id> "<text>"` replaces the bullet text **preserving the id**.
2. Re-run `analyze rules` (re-hashes only this rule) and `generate rule scripts --only RL-<id>`.
3. Diff the regenerated scripts against the prior set; if behavior changed, surface a Decision Pause packet before accepting.

## remove — `remove rule RL-<id>`

`edit-rule.mjs remove <root> RL-<id>` deletes the bullet and moves the map entry into `archived:` (delayed delete). The script files stay on disk until the next `generate rule scripts` cycle prunes them — see `rule_compliance.archive_retention`.

## downgrade — `mark rule RL-<id> as unverifiable`

`edit-rule.mjs downgrade <root> RL-<id> "<reason>"` keeps the rule, clears its scripts, and flips the map entry to `verifiability.kind: unverifiable` with the recorded reason.

## Invariants

- The id is stable through reword, file move, and split — it lives in the marker, not in text or line numbers.
- Every map write goes through `src/rule-scripts/apply.ts` (snapshot + atomic rename + events log).
- Two devs editing **different** rules merge cleanly per-rule; only editing the **same** rule produces a normal text-file conflict.
