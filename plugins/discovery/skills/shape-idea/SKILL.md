---
name: shape-idea
description: "Chat and Claude Code: Step 3 of the product-discovery idea journey, Shape it. Plays the idea back starting with the goal, looks at it through the expert lenses, offers options with trade-offs and a smaller first step where useful, and gives a recommendation. Raises any real risk in business terms, and if the idea already exists it says so with the source and recommends the already-exists outcome. Produces the playback block of the discovery record. Runs when the product-discovery journey directs it; not started directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# shape-idea

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, one short sources line at the end. Those rules win
over everything else here.

## When this runs

Runs when the product-discovery journey directs it; not started directly. It is step 3, Shape
it, and runs after the idea block (step 1) and the today block (step 2) are in the record. Say
the one-line status when you enter it, for example "Step 3 of 6: shaping the idea."

## What it does

Shape the idea, do not just repeat it. Work only from the idea and today blocks already in the
record and from what the user has said. Follow `references/challenge-guide.md` for how to raise
a conflict kindly, and `references/expert-lenses.md` for the lenses.

1. Play the idea back, goal first. Use the shape in `references/playback-template.md`: the goal,
   what exists today (including what the docs could not confirm), the options with their
   trade-offs in business terms, a smaller first step where it helps, and a recommendation. The
   playback calls an area the documents do not cover not documented, never says or implies it is
   not built, and keeps the label on any line the code suggests, as in "What the documents prove"
   in `references/paqad-docs-map.md`. It may rest on docs-and-code or code-only evidence, each kept
   at its level, and carries the one source line for the run's evidence level
   (`references/evidence-levels.md`). End the playback with the sources line, then the closing
   question last, through the choice prompt.
2. Look through the expert lenses (`references/expert-lenses.md`): customer value and experience,
   business and cost, operations and support, data and privacy, security and access, and rollout
   and change for existing users. Raise only what matters for this idea, in business terms, each
   with a recommendation. A privacy or security risk, such as sending customer personal data out
   of the product, is named here plainly with what you would do about it.
3. Offer options as a choice through the host's choice prompt, each with its trade-off in a few
   words (time, cost, risk, effect on users), the recommended one marked with one short clause of
   why.
4. Offer a smaller first release or an experiment with a success condition when the idea is large
   or uncertain, naming what result would justify going further.
5. If the idea already exists as a documented capability, or the today block holds a line the code
   suggests that shows it exists, say so with the source and the level's source line, keep the label
   "the code suggests" on a code-based line, recommend the already-exists outcome and draft nothing
   more unless the user asks.
6. Label every suggestion as a suggestion. Nothing enters the record until the user accepts it.
   Respect an informed choice once the user makes it; revisit it only for new evidence.

## If the checks cannot run

This skill carries no script. Shape the idea by hand with this checklist:

- Playback leads with the goal, then today, then options and trade-offs, then a smaller first
  step where useful, then a recommendation. It ends with the sources line, then the closing
  question last.
- Options and the way forward on a challenge are offered through the choice prompt (a short list
  in the reply only when the host has none), the recommended one marked.
- Each of the six lenses was considered; the ones that matter for this idea are raised in
  business terms with a recommendation, the rest left out.
- A real risk, conflict or duplicate is named with its evidence and a way forward.
- Where the idea is large or uncertain, a smaller first release or experiment with a success
  condition is offered.
- If the idea already exists, that is said with the source and the already-exists outcome is
  recommended.
- Do "What the documents prove" in `references/paqad-docs-map.md` by hand from the record: call
  an area the today block does not document not documented; never say or imply it is not built;
  keep "the code suggests" on every line from the code.
- Every suggested measure or scope cut is labelled a suggestion and only recorded once accepted.

## Output

Fills the playback block of the discovery record: goal-first playback, the lens notes, the
options with trade-offs, the smaller first step, and the recommendation. The product-discovery
skill writes the block through its record script once the user accepts the shaping; this skill
produces the content.
