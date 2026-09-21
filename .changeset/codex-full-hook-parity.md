---
'paqad-ai': minor
---

feat(codex-cli): wire paqad's full hook set so feature-development stages are enforced on Codex exactly as on Claude Code (#566)

Codex CLI moves from the `live-completion-only` tier to `live-pre-and-completion`. One
native-hook renderer now drives every hook-capable host from a single ordered chain, so
Codex gets the entry-gate block, the plan-and-spec-before-code block, the decision-pause
block, the rules-loaded block, the capability kernel, and the spoken completion verdict —
the same guarantees as Claude Code, wired into `.codex/hooks.json` across all four
lifecycle events (SessionStart, UserPromptSubmit, PreToolUse `^apply_patch$`, Stop).

The same hook scripts run on both hosts; the host is one argv, never a fork. A single
`edit-targets` extractor parses the edited paths from a Codex `apply_patch` (or a Claude
`file_path`), so the gates and the stage writer are host-aware without duplicated parsing.
`paqad-ai doctor` gains a `Codex hooks wired` check, and onboarding with `codex-cli` prints
the one-time `/hooks` trust step. Gemini stays record-only and every advisory host is
unchanged; the Claude and Gemini generated configs are byte-identical to before.
