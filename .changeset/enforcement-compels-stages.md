---
'paqad-ai': minor
---

Make the feature-development stage workflow **compel, not plead** (enforcement RCA, part 1 of the fix).

The stage-evidence recorder finally has a production caller, and a code edit is now blocked until the prior stages are recorded — closing the physics gaps that let every prior fix (#117–#261) regress.

- **Deterministic per-stage writer.** A new Claude PreToolUse hook (`stage-writer.mjs` → `src/stage-evidence/live-writer.ts`) script-mints a `live-mark` stage row on every Edit/Write/NotebookEdit, with real start/end times classified from the mutated file — no model involvement. The completion finalizer closes any stage left open at the turn boundary.
- **Block-forward deny.** A `stages` capability folded into the kernel evaluates at the pre-mutation seam and refuses an edit (exit 2, reason on stderr) until `planning` and `specification` each carry a recorded start+end pair. It reads the ledger, not a git delta, so a committed clean tree cannot bypass it. `se-mark` (a Bash script, ungated) is the escape hatch that clears the block.
- **Visible, non-vacuous verdict.** The Stop backstop now writes a failing verdict to **stderr** (the host surfaces only stderr to the model on exit 2), and the stage gate no longer skips on a zero-file working-tree diff — a committed-but-incomplete change still fails instead of passing silently.

Claude-only for the hard block (the only host with a pre-mutation seam); Codex/Gemini keep completion-time recording; other adapters are unchanged. Default `stages_mode` is strict.
