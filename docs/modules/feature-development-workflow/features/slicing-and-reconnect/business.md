# Build in Small Pieces & Reconnect to the Whole

> **Layer:** `agent-workflows` · **Slug:** `slicing-and-reconnect` · **Issue:** #104

## What it is

A discipline for *how big each step of building is*. Instead of building a whole feature and checking it
all at the end — where problems pile up tangled together — paqad builds in **thin slices, default one
acceptance criterion at a time**, taking each slice fully through its checks before the next begins. When
the slices are built it runs a **reconnect check**: confirming the pieces fit together against the
**frozen** whole-feature spec, not just that each passed alone.

1. **One criterion per slice** — the default unit of work is a single, independently-testable acceptance
   criterion. Planning never slices below one; criteria with several parts (`negative_cases`,
   `edge_cases`) are built together and proven as one whole.
2. **One at a time** — each slice runs to "checked and correct" before the next starts, so problems
   attach to the one slice that caused them.
3. **Reconnect to the whole** — after the slices are built, a real check confirms every frozen criterion
   is covered and proven, no two slices contradict each other, and no cross-slice seam is left unwired.

## Why it matters

Working in small batches is among the best-evidenced levers on software *delivery* performance: smaller
changes integrate faster, carry less risk, and are easier to revert, while big batches let defects and
integration problems compound. The AI-specific subtlety: an agent *can* slice smaller than a human team
could, because it holds the whole feature in view — **but that grip fades on long jobs**. So the
reconnect must anchor on the *written frozen spec* (#102), never on the agent's memory of the feature.

## How it behaves

- On `graduated` / `full` lanes, planning is rejected if a slice proves **no** acceptance criterion
  (below the floor) or **combines several** criteria without recording a `combine_reason`.
- Slices are combined only when separating them would break the work, and that exception is recorded.
- Each slice is taken fully through its checks before the next begins (enforced by the slice executor's
  one-at-a-time loop).
- The reconnect check **can fail** — it is not a rubber stamp. It fails on a coverage gap, an unproven
  criterion, an off-spec or double-owned criterion, or a slice wired onto a missing/unproven upstream.
- The reconnect anchors on the **frozen** spec; an unfrozen spec is never coherent.
- Reconnect strength scales with lane: structural AC-coverage + seam checks by default, escalating to an
  agent re-read of the spec on the `full` lane.
- The `fast` lane keeps building trivial work **in one step** — no slicing, no reconnect ceremony.

## Boundaries

This feature owns **slicing** (default unit = one acceptance criterion) and the **reconnect-to-whole**
check. It does **not** own:

- what an acceptance criterion *is* / authoring it → #102 (reuses `VerificationCriterion`);
- running, proving, or retrying the checks a slice passes through → substrate D, #103 & #108;
- the durable two-way spec ↔ code ↔ test map → #109 (reconnect here is coherence *at build time*).
