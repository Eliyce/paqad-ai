---
'paqad-ai': patch
---

Make feature-development stage narration visible on Claude Code Desktop (#409).

The stage hooks narrate on Claude's `{systemMessage}` channel, which the Desktop app
records as a hook attachment and never renders in the chat. A verified six-stage run
emitted eleven `▸ paqad` stage lines and the developer saw none of them, while the
evidence bundle was complete — recorded but unnarrated, the inverse of #389.

The narration contract now tells the Claude Code agent to speak its own stage lines and
the one end-of-change receipt in visible assistant text, placed in the turn's final
message, and carries a per-surface table of which channels actually render instead of
the previous single wrong assumption. A new deterministic backstop reads the turn
transcript and reports any stage recorded this turn with no matching visible narration,
advising the model to relay the receipt. The check is advisory: it never turns a passing
verdict into a failing one and never blocks a turn.
