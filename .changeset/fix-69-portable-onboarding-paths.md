---
'paqad-ai': patch
---

Stop leaking absolute install paths into committed onboarding artifacts (#69). The hooks manifest (`.claude/settings.hooks.json`, `.codex/hooks.json`, `.gemini/hooks.json`, etc.) now stores only the package-relative `source` and resolves the hook script at runtime, instead of baking in `/opt/homebrew/lib/node_modules/paqad-ai/...` or `~/.npm/_npx/<hash>/...` from the onboarding user's machine. A teammate cloning the repo (different OS user, different package manager, Mac vs. Windows) can now run Paqad without every hook 404'ing, and usernames/machine layout no longer end up in source control. Adds a portability test that scans all generated config across every adapter × fixture combination for leaked absolute paths.
