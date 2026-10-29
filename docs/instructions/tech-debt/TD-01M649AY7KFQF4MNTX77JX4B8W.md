---
id: "TD-01M649AY7KFQF4MNTX77JX4B8W"
title: "Live headline Svg can clip a long title and its clock with no ellipsis at narrow Desktop widths"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/desktop-view.ts"
  - "runtime/claude-plugin/mod/strip.ts"
found_in:
  change: "01M645V4RH7QQ7DZ5EK9AD0SKJ"
  issue: "776"
  stage: "review"
found_by: "review"
session: "4452c3b8-4135-4ed3-a93c-955a3aafff26"
created_at: "2026-10-29T16:54:19.617Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The live headline on Desktop is now one plain-image Svg (`liveHeadline` in `runtime/claude-plugin/mod/strip.ts`). Its title is cut by `fitLine(text, columns - 2)` in `desktop-view.ts`, a character count that assumes about 8.5 px per column. The title is drawn at 17 px, weight 600, starting at x 20, and the note and clock follow as tspans. The Svg markup is only `max(480, round(columns x 8.5))` wide. A long title (for example a long subagent description at 57 columns) can run past the viewBox. It is then clipped mid-glyph with no ellipsis, and the note and clock are clipped off. The old `Text wrap="truncate-end"` had the renderer as a backstop. An Svg has none.

The spec (FR-6) asked for `fitLine(...)` as today, so the change keeps this limit.

## Follow-up

Fit the live title to the Svg width in px instead (for example, a per-character width budget for 17 px semibold, keeping room for the note and clock), or drop the note and clock first when the title is long. Check it on Desktop at 57 columns with a long subagent description.
