---
name: understand-idea
description: "Chat and Claude Code: Step 1 of the discover journey: clarifies the goal, who benefits, success and constraints into the idea block. Use when discover runs step 1, not directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# understand-idea

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

Step 1: your idea. Fills the `idea` block.

## When this runs

Directed by the discover journey; not started directly.

## What it does

1. Extract before asking (CON-2) from the first message and the documents. If the goal, who benefits
   and success are already clear, move straight on.
2. Ask one question at a time, only about a material gap, until the goal, who benefits, success and
   constraints are clear (`references/question-bank.md`).
3. Ask as a consultant (CON-1). Each question carries one recommendation and two or three realistic
   choices, short (TALK-8), through the host's choice prompt with the recommendation marked (a list
   only when there is no prompt). "I don't know" is accepted: offer a default, say it is an
   assumption, and note it.
4. When the user cannot state what success looks like, follow `references/success-prompts.md`: offer
   two or three suggested measures through the choice prompt, each labelled a suggestion, and keep
   only the one the user accepts (AC-25, CON-6).
5. Keep the user's words; note any project-term pair for the glossary (GRD-6).

## If the checks cannot run

No script; the method is this checklist:

- Confirm the goal is stated: who gets what value.
- Confirm who benefits: the role or people served.
- Confirm what success looks like: a measure the user accepts, or a suggested measure they chose,
  or an explicit "to be measured once it ships".
- Confirm the constraints: anything that limits the idea (time, cost, rules, systems to respect).
- For each gap, ask one grounded question with a recommendation and two or three choices, through
  the choice prompt (a short list only when the host has none). Record an accepted default as a
  labelled assumption. Never invent a success number.

## Output

The `idea` block: goal, who_benefits, success and constraints, plus accepted defaults as assumptions
and term pairs for the glossary.
