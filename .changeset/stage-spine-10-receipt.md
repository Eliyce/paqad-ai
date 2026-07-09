---
'paqad-ai': minor
---

Stage-Spine 10 (#325): one end-of-change paqad receipt — surface the verdict, cut the noise.

paqad's most valuable narration moment (the final verdict) had no reliable visible
surface and didn't use the contract's own words, while the cheapest moments (per-stage
boundaries) were spoken twice. This inverts the cadence:

- The trust verdict now speaks the contract vocabulary — `Safe to merge` /
  `Needs your attention` / `Inconclusive` with the fixed status glyphs, led by the
  `▸ paqad` frame — consuming `paqad-voice.ts` (fulfilling its single-source claim).
- A new end-of-change **receipt** composes the verdict headline with one line per stage,
  each carrying honest provenance: a stage that was only marked (no artifact, or a
  near-zero duration) reads 🟡 "marked (no recorded work)", never 🟢 "done".
- The receipt is emitted as a visible `{systemMessage}` on the Claude completion hook
  (was buried on stdout); the git/CI backstop keeps plain text.
- The duplicated per-marker END narration line is muted (the ledger write is unchanged —
  only the second spoken line is dropped).
- The generated narration contract now states, per host, who narrates: Claude Code's
  hooks speak for you, but on Codex/Gemini the record hook is silent so the model must
  narrate its own markers — it no longer claims hook-driven ledger narration there.
