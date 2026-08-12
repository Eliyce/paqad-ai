---
'paqad-ai': patch
---

fix: stop the `Stop says:` narration leak — silence Stop-hook `{systemMessage}` prose

Claude Code changed how it renders Stop-hook output: a Stop-hook `{systemMessage}` now renders on Desktop as literal `Stop says:` lines, inverting the premise the #368/#409 narration design was built on (that the channel was invisible, so the agent speaks the receipt and the hook echo is a silent backchannel). With the host inverted, paqad's three Stop-event emitters poured user-facing prose into that channel on every turn, across every onboarded repo and machine — duplicating the receipt the agent already speaks and leaking the model-only narration advisory into the developer's chat.

The Stop hooks no longer emit user-facing `{systemMessage}` prose:

- `runtime/scripts/verify-backstop.mjs` (`hook-completion`): writes nothing on a pass/inconclusive turn and only a model-only `{decision:'block'}` reason on a hard failure. Enforcement is unchanged — the block reason reaches the model (never rendered on either host) and the git/CI backstop still hard-fails with exit 2.
- `runtime/hooks/capability-gate.mjs` (`completion` seam): no longer echoes narration on the allow path; the `pre-mutation` (PreToolUse) seam is unchanged.
- `runtime/hooks/stage-marker-parse.mjs`: still records every parsed marker to the ledger; only the chat echo is removed.

The developer-facing channel is the agent's own final message (the #409 contract), which was always the intended primary channel. The narration contract docs and the verification module doc are corrected to state the new host behavior. Decision `D-01KZV9HFGDXZ03J0S6P9BTQ53Q` records the approach.
