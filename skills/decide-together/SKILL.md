---
name: decide-together
description: Step 4 of the product-discovery idea journey, Decide. Settles the open choices one at a time, each with a recommendation and two or three realistic options, and records every decision with who decided and why. When the user does not know, it offers a sensible default, labels it as an assumption, and stores it in the assumptions block. Produces the decisions block of the discovery record. Runs when the product-discovery journey directs it; not started directly.
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
   short, with the recommended one marked and one short clause of why. Use what the user and the
   documents already say before asking; ask only about the real gap.
3. When the user decides, record the decision: an id, the question, the choice, who decided, and
   why. Keep the user's own words for the reason where they are clear.
4. When the user says "I don't know", accept it. Offer a sensible default, say plainly that it is
   an assumption, and store it in the assumptions block with an id, the question, the default and
   why. A default is never recorded as a settled decision.
5. Keep settled choices settled. Revisit one only if new evidence appears, not to reopen a call
   the user already made with the facts in front of them.

## If the checks cannot run

This skill carries no script. Decide and record by hand with this checklist:

- Each open choice was taken one at a time, not as a batch.
- Every choice was offered with a recommendation and two or three short options.
- Each decision is recorded with its id, question, choice, who decided, and why.
- An "I don't know" produced a labelled assumption in the assumptions block, never a silent
  decision, with its id, question, default and why.
- No number, date, name or scope was invented; only what the user accepted was recorded.

## Output

Fills the decisions block of the discovery record (a list of recorded decisions) and the
assumptions block (the accepted defaults, each labelled as an assumption). The product-discovery
skill writes these blocks through its record script; this skill produces their content.
