# Ask the Owner Once: Business View

> Module: **Decision Pause Contract** (`decision-pause-contract`) · Layer: `framework-internals` · Feature slug: `ask-owner-once`

## Overview

paqad used to stop and ask the owner at several points in a change: while planning, after the
experts reviewed the spec, and again before development. Some of those questions were not real
choices. Two experts saying compatible things about the same file still turned into a question.

Now the owner is asked once per change, and only about real choices. The technical contract
lives at [`technical.md`](./technical.md) and the commands at [`api.md`](./api.md).

## What changed for the owner

- **One question round per change.** On the graduated and full lanes, every open question for a
  change waits for the spec questions step and is asked there together, up to 4 at a time,
  back to back. That includes the module the change belongs to, the fix proof method and the
  visual-evidence readiness question.
- **Agreeing expert claims are merged, not asked.** When experts say things that can all be true
  at once, the chief architect writes one merged claim instead of a question. The round opens
  with "The experts agreed on N points after merging overlaps" and lists those merged claims so
  you can still see them. Real disagreements, and any conflict that involves a must-level
  security finding, are still asked.
- **The same disagreement is never asked twice.** If you already answered it, the answer is reused.
- **A question only holds its own change.** A pending question blocks edits for the change it
  belongs to. Other changes keep moving.
- **Planning stops asking when it is sure.** If paqad is confident about which module a change
  belongs to (score 0.5 or more), it applies that choice and shows it in the round as a choice
  you can change. If it is unsure, the question joins the round instead of stopping planning.

## Business Rules

- Nothing is answered for you. If you answer only part of a round, the rest stay pending and the
  next round asks only those.
- On the fast lane, or with the spec pipeline off, there is no round, so the readiness question
  is still asked straight away.
- Questions raised during development about a spec change or contradiction are always asked at once.
- A project that sets `attribution_pending: stop` keeps the old behaviour of stopping during planning.
