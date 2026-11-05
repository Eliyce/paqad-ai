---
'paqad-ai': minor
---

Stage agents now follow one recipe and prove it, and the ledger records what they really reported.

- The record now reads each stage's real report, whether the agent handed it back or ended in plain text. A stage that says it finished without its result is sent back, up to three times, then recorded as blocked with the reason.
- `paqad-ai stage report <agent_id>` tells the main chat what a stage reported and what to do next, and the next stage refuses to start past a stage that stopped.
- `paqad-ai stage begin <stage>` starts a stage in one command and prints what it needs, so a stage takes fewer turns.
- The stage ledger gains a lock, a hash chain and duplicate protection. The chain catches accidents and silent loss, not someone who rewrites the file on purpose, and it cannot see rows cut from the end.
- Each stage gets its recipe at start. Its stage command checks the recipe's script, and the end-of-change check asks each new stage for that proof. On Codex the recipe is written to the project, kept out of git, and read rather than injected.
- Agent files are short and each do-not line names what enforces it. Plugin and npm installs now render the same failure policy on the edit gates.
- On the plugin route the three edit gates now block when their hook cannot run (`onFailure: block`, measured on Claude Code 2.1.302). If a partial install or a missing `node` blocks every Edit and Write, run `/plugin update`, which needs no edit, and try again.
- `paqad-ai stage repair <row> --reason <text>` records why a ledger row broke the chain, and the end-of-change check accepts a row repaired that way.
- The rule check before an edit no longer refuses an edit that only removes a finding. If the edit takes at least one finding out of its file and adds none, it passes and is recorded, and any other findings still block at the end of the turn. This does not apply under `rule_gate_pre_edit=all`.
- When an agent draft asks for risky powers, `agent test` waits on one approval decision for that exact file. If the file changes while the decision is unanswered, the old decision is discarded and a new one is raised for the file as it is now.
- The Ledger shows recipe, report and turns per stage, and the receipt states turns against the budget.
