---
'paqad-ai': patch
---

fix: produce the evidence ledger on every provider, not Claude Code alone

The verification-completion run that writes `.paqad/ledger/` only fired from Claude Code's native `Stop` hook, so onboarded projects driven by Codex, Gemini, or any other host produced no evidence ledger even with `enterprise.evidence_ledger` enabled. The completion hook was rendered into Claude's config alone; every other adapter wrote inert hook metadata its host never executes.

Each hook-capable host now gets its native completion hook wired during onboarding, from one shared definition (`src/adapters/shared/native-completion-hook.ts`): Codex `Stop` in `.codex/hooks.json`, Gemini `AfterAgent` in `.gemini/settings.json`. They point at a new record-only runtime hook (`runtime/hooks/verification-record.mjs`) that writes the ledger but always exits 0 and stays silent, so a host that reads a Stop-hook's exit code or stdout never gets blocked or retried. No change to any host's entry file (`AGENTS.md` / `GEMINI.md`) — the fix lives entirely in the hook layer. Hosts without a native completion hook remain covered by the git/CI backstop. A new `docs/instructions/rules/coding/cross-provider-parity.md` rule and a cross-adapter parity test guard against a capability being wired for a single host again. Cursor and Windsurf native hooks are tracked as follow-up.
