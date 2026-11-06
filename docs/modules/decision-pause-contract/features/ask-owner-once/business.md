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
- **An earlier answer is one click away.** When a new question looks like one you answered
  before, paqad checks whether that answer still fits and shows it first as
  `Same as last time: <label> (from D-...)`. Approve it, pick another option, or, when there is
  room, choose `Always use this answer for this kind of question`.
- **Only you can make a question go away.** A question is skipped only by a standing answer a
  person chose. It applies to the whole team once merged and lasts until someone runs
  `paqad-ai decision standing remove <id>`. Add `--ask-anyway` to `decision create` to be asked
  this one time.
- **You can see what happened.** The end-of-change receipt can say
  `decisions: 3 earlier answers suggested, 2 accepted, 1 changed; 1 standing answer used`.
- **Planning stops asking when it is sure.** If paqad is confident about which module a change
  belongs to (score 0.5 or more), it applies that choice and shows it in the round as a choice
  you can change. If it is unsure, the question joins the round instead of stopping planning.

## Business Rules

- Nothing in a round is answered for you, apart from a standing answer you chose and the existing
  reuse of an answer to the same disagreement. If you answer only part of a round, the rest stay pending and the
  next round asks only those.
- On the fast lane, or with the spec pipeline off, there is no round, so the readiness question
  is still asked straight away.
- Questions raised during development about a spec change or contradiction are always asked at once.
- Nine sensitive kinds of question can never have a standing answer, such as a spec change, an
  architecture path or consent over personal data. A stage agent cannot set or remove one.
- Spec questions answered from a close precedent still auto-answer as before, and are now logged.
- A project that sets `attribution_pending: stop` keeps the old behaviour of stopping during planning.
