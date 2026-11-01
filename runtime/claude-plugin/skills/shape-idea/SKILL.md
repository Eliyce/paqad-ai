---
name: shape-idea
description: "Chat and Claude Code: Step 3 of the discover journey: plays the idea back with options, trade-offs and a recommendation. Use when discover runs step 3, not directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# shape-idea

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

## When this runs

Directed by the discover journey, not started directly: step 3, after the idea and today blocks are
in the record. Say the status on entry ("Step 3 of 6: shaping the idea.").

## What it does

Shape the idea, do not just repeat it, working only from the idea and today blocks and what the user
said. Raise conflicts kindly (`references/challenge-guide.md`).

1. Play the idea back, goal first. Use the shape in `references/playback-template.md`: the goal,
   what exists today (including what the docs could not confirm), the options with their
   trade-offs in business terms, a smaller first step where it helps, and a recommendation. An
   uncovered area is not documented, never not built, and code lines keep "the code suggests"
   ("What the documents prove" in `references/paqad-docs-map.md`). Evidence stays at its level, with
   the run's one source line (`references/evidence-levels.md`). End with the sources line, then the
   closing question through the choice prompt.
2. Look through the expert lenses (`references/expert-lenses.md`): customer value and experience,
   business and cost, operations and support, data and privacy, security and access, and rollout
   and change for existing users. Raise only what matters, in business terms, each with a
   recommendation. Name a privacy or security risk (such as customer personal data leaving the
   product) plainly with what you would do about it.
3. Offer options through the host's choice prompt, each with a few-word trade-off (time, cost, risk,
   effect on users), the recommended one marked with a short why.
4. When the idea is large or uncertain, offer a smaller first release or an experiment with a
   success condition that would justify going further.
5. If the idea already exists as a documented capability, or a code-suggests line in the today block
   shows it exists, say so with the source (keeping "the code suggests" on code lines), recommend the
   already-exists outcome and draft nothing more unless asked.
6. Label every suggestion as one; nothing enters the record until accepted. Respect an informed
   choice; revisit it only for new evidence.

## If the checks cannot run

No script; shape by hand with this checklist:

- Playback: goal, today, options and trade-offs, smaller first step where useful, recommendation,
  sources line, closing question last.
- Options and the way forward on a challenge are offered through the choice prompt (a short list
  in the reply only when the host has none), the recommended one marked.
- Each of the six lenses was considered; the ones that matter for this idea are raised in
  business terms with a recommendation, the rest left out.
- A real risk, conflict or duplicate is named with its evidence and a way forward.
- Where the idea is large or uncertain, a smaller first release or experiment with a success
  condition is offered.
- If the idea already exists, that is said with the source and the already-exists outcome is
  recommended.
- "What the documents prove" (`references/paqad-docs-map.md`) by hand: an area the today block does
  not document is not documented, never not built; code lines keep "the code suggests".
- Every suggested measure or scope cut is labelled a suggestion and only recorded once accepted.

## Output

The content of the playback block: goal-first playback, lens notes, options with trade-offs, the
smaller first step and the recommendation. discover writes it once the user accepts the shaping.
