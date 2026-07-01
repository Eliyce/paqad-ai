---
'paqad-ai': minor
---

Add a native `aiassistant` adapter for JetBrains AI Assistant (#219).

- Onboarding and `paqad-ai refresh --providers` now generate and keep in sync `.aiassistant/rules/guidelines.md`, the lean bootstrap-pointer entry file AI Assistant auto-applies from `.aiassistant/rules/`.
- Soft, rules-only adapter (advisory hook coverage), like `junie`: AI Assistant exposes no hook/lifecycle system, so the sentinel gate cannot bind. MCP is intentionally omitted — AI Assistant configures MCP servers in the IDE, not a project file, so no dead artifact is written.
- The adapter is selectable everywhere the other ten are (onboarding prompt, `--providers`, factory), carries its Decision Pause Contract UI note, and is covered by tests parallel to `junie`.
- Also synced the `onboarding-manifest` schema `adapter` enum to the full adapter list (it had silently drifted to five, so a `cursor`/`aider`-onboarded manifest failed health-check validation).
