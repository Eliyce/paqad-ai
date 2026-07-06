---
'paqad-ai': minor
---

Decision Pause now mints packets on more of the forks that matter (#300, option B2):

- **Self-arm broadened to architecture-path.** Alongside create-vs-reuse (0.92), the opt-in self-arm minter now also arms on a new tight `explicit-path-fork` detector signal (0.90) — two distinct file paths offered as alternatives ("live in X or Y", "X vs Y"). The pre-existing broad architecture-path signals (a bare "or", two paths merely mentioned) stay at 0.64 and never clear the arming bar, so a stray "or" cannot mint a pause. Self-arm remains OFF by default.
- **spec.change now has a deterministic minter.** A new always-on, no-opt-in spec-change guard runs at the pre-mutation seam: when a persisted frozen spec's source markdown has moved since freeze (`isFrozenSpecStale`), it mints one `spec.change` pause via `buildSpecChangePacket`. It is naturally inert until a spec is frozen and its sidecar persisted (`writeFrozenSpec`), so nothing changes for projects that do not use the spec-freeze lifecycle. Both minters only write a pending packet; the existing decision-pause gate still owns the block on the next edit.

Cross-provider: the architecture-path leg inherits self-arm's existing transcript-based provider coverage (parity with `HOOK_COVERAGE_MATRIX`); the spec-change guard is provider-independent (it reads spec files on disk, not the turn transcript).

Also fixes `buildSpecChangePacket` copy that could never pass `lintDecisionCopy` (banned word "invariant", non-approved label verb, em dashes), which had silently blocked the packet from ever being written to the pending store.
