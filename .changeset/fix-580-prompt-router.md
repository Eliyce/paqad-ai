---
'paqad-ai': patch
---

Prompt router no longer mislabels questions as feature-development, and a clean working tree no longer triggers a whole-tree rule block (#580).

The deterministic classifier used to match code-change keywords (`fix`, `bug`, `add`, `build`, `cleanup`) as plain substrings and rank them above the question check, so "What does the **add**ress field store?", "Can you explain the de**bug** output?", and "Why does the pre**fix** get dropped?" were all routed to feature-development — loading rules, code-scope retrieval, and completion enforcement for a plain question. Keywords now match on whole words with explicit inflections (so "added" still matches but "address" does not), the project-question check runs before the code-change keywords, and an explicit "no code" or "file an issue" ask routes to project-question. Genuine code requests, including polite ones like "Can you add a logout button?", stay feature-development.

At the completion seam an empty change set now means nothing to enforce: a turn with a clean working tree returns a `⚪ scripted rules: skipped (no files changed this turn)` verdict instead of scanning the whole repository and blocking on pre-existing violations the turn never touched. Explicit whole-tree scans keep their behaviour.

New `paqad-ai route set <workflow>` command lets the agent correct the hook's label when its deterministic guess disagrees with the intent the agent read: it rewrites the active per-session route, clears any stashed lane on a non-feature correction, and records an `agent-override` audit row. It refuses to leave feature-development once source files have been edited this turn.
