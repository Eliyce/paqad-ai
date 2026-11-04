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
- The Ledger shows recipe, report and turns per stage, and the receipt states turns against the budget.
