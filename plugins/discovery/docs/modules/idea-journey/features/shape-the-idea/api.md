# Shape the idea with options and risks: API

This feature has no network or HTTP API and no script of its own. It is the `shape-idea` step skill, run at step 3 only when the `product-discovery`
journey directs it. It reads `idea` and `today` and the references `playback-template.md`,
`expert-lenses.md`, `challenge-guide.md`, `paqad-docs-map.md` and `evidence-levels.md`.

| Item | Value |
|---|---|
| Inputs | Record blocks `idea`, `today`, `glossary` |
| Reply contract | Playback: goal, today, options with trade-offs, smaller first step, recommendation, then the Sources line and source line, then the closing question last (TALK-13); options and a challenge's way forward offered through the choice prompt (TALK-8, CON-3) |
| Output block | `playback` `{goal_first_playback, lenses, options, smaller_first_step, recommendation}`, written once the user accepts |
| Written by | `product-discovery` through `record.py update` (see [record-lifecycle API](../../../discovery-record/features/record-lifecycle/api.md)) |
| Exit condition | `playback` present and not stale (`record.REQUIRED[3]`) |
