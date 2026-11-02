---
name: decide-together
description: "Chat and Claude Code: Step 4 of the product-discovery journey: settles the open choices and records each decision and assumption. Use when the journey directs it to step 4, not directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# decide-together

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, one short sources line at the end. Those rules win
over everything else here.

## When this runs

Runs when the product-discovery journey directs it; not started directly. It is step 4, Decide,
and runs after the idea is shaped in step 3. Say the one-line status when you enter it, for
example "Step 4 of 6: deciding the open choices."

## What it does

Settle the choices left open by the shaping, one at a time, and record each as it is made. Follow
`references/decision-template.md` for the shape of a recorded decision and a recorded assumption.

1. Take the open choices one at a time. Do not batch them into a wall of questions.
2. Bring something to every choice: a recommendation and two or three realistic options, kept
   short and asked through the host's choice prompt, the recommended one marked with a short why.
   Use what the user and the documents already say; ask only about the real gap.
3. When the user decides, record the decision: an id, the question, the choice, who decided, and
   why. Keep the user's own words for the reason where they are clear.
4. When the user says "I don't know", accept it. Offer a sensible default, say plainly that it is
   an assumption, and store it in the assumptions block with an id, the question, the default and
   why. A default is never recorded as a settled decision.
5. Keep settled choices settled. Revisit one only if new evidence appears, not to reopen a call
   the user already made with the facts in front of them.
6. Name the direction. Step 4 also settles the `outcome` block: the chosen direction (build,
   experiment, already exists, process change, defer or stop), the reason and the next action.
   Confirm it with the user through the choice prompt as the deciding closes; the product-discovery
   skill records it alongside the decisions block.

## If the checks cannot run

This skill carries no script. Decide and record by hand with this checklist:

- Each open choice was taken one at a time, not as a batch.
- Every choice was offered through the choice prompt (or a short list when the host has none)
  with a recommendation and two or three short options.
- Each decision is recorded with its id, question, choice, who decided, and why.
- An "I don't know" produced a labelled assumption in the assumptions block, never a silent
  decision, with its id, question, default and why.
- No number, date, name or scope was invented; only what the user accepted was recorded.

## Output

Fills the decisions block of the discovery record (a list of recorded decisions), the assumptions
block (the accepted defaults, each labelled as an assumption), and the `outcome` block (the chosen
direction, reason and next action that step 4 requires). The product-discovery skill writes these
blocks through its record script; this skill produces their content.
