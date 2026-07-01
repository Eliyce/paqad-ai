---
'paqad-ai': minor
---

Extend the enforcement record tier from Claude-only to Codex and Gemini, and document the honest cross-provider tier ladder (issue #265).

The stage writer and pre-edit block are Claude-only by physics (only Claude Code exposes a pre-mutation hook). But the _ledger_ half of the fix is portable to any host with a completion hook, so it now binds on Codex and Gemini too:

- **Codex / Gemini record their `paqad:stage` markers at turn end.** The record-only completion hook (`verification-record.mjs`, wired on Codex `Stop` and Gemini `AfterAgent`) now parses the agent's stage markers from the turn transcript and writes them to the same stage-evidence ledger the completion verify folds. Each row is attributed to the host that ran (`codex-cli` / `gemini-cli`), passed to the hook as an argv — never mislabelled `claude-code`. Codex reads its `transcript_path`; Gemini falls back to the inline `prompt_response` because its `transcript_path` is currently stubbed empty upstream ([google-gemini/gemini-cli#14715](https://github.com/google-gemini/gemini-cli/issues/14715)). The parser degrades gracefully to a raw-text scan when a transcript format is not the Claude JSONL shape.
- **Record-only, by design.** These hooks still always exit 0 and stay silent — there is **no in-chat verdict** on Codex/Gemini, because Codex rejects plain text on `Stop` and Gemini forces a retry on `decision: deny`, so the only non-disruptive channel is the ledger. The verdict is visible via the dashboard / SIEM export, never shoved into the chat.
- **No pre-edit block, stated plainly.** Codex/Gemini have no pre-mutation seam, so the hard block stays Claude-only. `docs/verification-enforcement.md` now carries a cross-provider guarantee table (hard block + verdict = Claude; record + ledger = Codex/Gemini; advisory = the 8 remaining hosts) and tracks the non-Claude hard block as a known, physics-bounded, upstream-blocked limitation.
- **The mandate holds:** enforcement is never added through an entry-file, prompt, or template edit. A parity test asserts the stage-writer and pre-mutation deny hooks are present for `claude-code` and absent for `codex-cli` / `gemini-cli` and every advisory host.
