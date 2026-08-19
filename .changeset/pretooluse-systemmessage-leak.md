---
'paqad-ai': patch
---

Fix: PreToolUse hooks no longer leak `{systemMessage}` into Claude Code Desktop chat

The `capability-gate` and `stage-writer` PreToolUse hooks emitted a top-level
`{systemMessage}` on their exit-0 (allow) path, on the now-false premise that a
PreToolUse `{systemMessage}` is invisible on Desktop. Claude Code now renders it
verbatim as `PreToolUse:<Tool> says:` lines — the same regression class as the
`Stop says:` leak — spamming framework prose into chat on every edit. Both allow
paths now emit nothing user-facing (the model speaks the narration; the ledger
write is retained; the strict/blocking path is unchanged). The narration-contract
channel table and the regenerated bootstrap are corrected to match.
