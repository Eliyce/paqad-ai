---
'paqad-ai': minor
---

Enablement-first entry flow: the gate speaks the verdict and the bootstrap splits into a gate + a router.

On a cold first turn the agent used to load the entire ~290-line `AGENT-BOOTSTRAP.md` — router, narration, stage protocol, and decision-pause contract — and narrate a workflow route before it had even checked whether paqad was enabled. Two fixes land:

- **The prompt-gate states the verdict.** The Claude Code `UserPromptSubmit` gate already resolves enablement deterministically and stays byte-for-byte silent when paqad is OFF, so if its `[paqad]` directive fires at all, paqad is ON. The directive now says so as its first line and marks enablement a done step, so the agent spends zero tool calls re-checking it. The numbered load-step prose that was hand-duplicated in both entry hooks now lives in one shared `runtime/hooks/lib/agent-entry-directive.mjs` module, and the stale hardcoded workflow count is gone.
- **The bootstrap splits into a gate + a router.** `AGENT-BOOTSTRAP.md` is now a ~23-line enablement gate (the precedence probe, the OFF bail-out, and a single "load `AGENT-ROUTER.md` when ON" pointer). The router, always-load list, sentinel, and the full narration and Decision Pause contracts move to a new `AGENT-ROUTER.md`, loaded only when enablement resolves ON. A disabled project never ingests any router or contract prose.

Both files ship in the install directory and are reached through the existing entry-stub chain, so the split lands on every provider (Claude Code, Codex, Gemini, and the advisory hosts) with no entry-file or project churn. The enablement resolvers and the sentinel semantics are unchanged.
