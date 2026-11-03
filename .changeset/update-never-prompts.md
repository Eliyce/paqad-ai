---
'paqad-ai': patch
---

`paqad-ai update` no longer asks the onboarding questions when you run it in a terminal. It used to ask for your providers, stack and RAG choice as if the project were new, and the answers decided which files it wrote, so a wrong pick could write another stack's rules or change the adapter. It now reads the providers the project was set up with and asks nothing. Onboarding saves every provider in `.paqad/onboarding-manifest.json` under `providers`, and `update` works them out from your entry files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and the rest) when an older manifest has no list. `update` also refreshes every provider's files now, not only Claude Code's. `paqad-ai onboard` still asks in a terminal.
