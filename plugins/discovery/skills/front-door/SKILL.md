---
name: front-door
description: "One place to start for product work, routing you to the capability that fits. Use it when you want to ask about the product, shape an idea, refine a ticket, size work, or plan a sprint and you want a single place to begin (\"help me with this ticket\", \"I have an idea\", \"what can you do here?\", \"where do I start?\"). It reads what you are after, names the capability that handles it, and hands you straight to it behind the scenes, so you only have to remember one entry. It is a thin router: it does no drafting, keeps no record, and writes nothing to the tracker itself; the capability it hands you to does that work."
---

# front-door

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the answer,
plain business words, no narration, one short sources line at the end. Those rules win over
everything else here.

This skill is the front door. It is a thin router: it reads what the user wants, names the one
capability that fits, and hands the user to it. It does no work of its own, keeps no record, and
never writes to the tracker. The capability it routes to does all of that.

## When this runs

Starts when the user wants a single place to begin and has not named a capability, or asks what
can be done here ("help me with this ticket", "I have an idea", "where do I start?"). You may
invite direct use. When the user already names what they want, hand straight to that capability
without asking again.

## What it does

1. Read the user's intent in plain words. Ask at most one short question only when the intent is
   genuinely unclear; otherwise route on what they already said.
2. Match the intent to one capability using the table below, and hand the user to it behind the
   scenes so the handover is invisible. Each capability is directly reachable on its own too; the
   front door is an added path, never the only one.
3. If nothing in the table fits, say so plainly in one line and name the closest capability.

## Where each intent goes

| What the user wants | Capability that handles it |
|---|---|
| Ask about the product: what it is, what it does, how something works today | ask-project |
| Shape an idea, a problem or a change into tickets or another sensible outcome | product-discovery |
| Refine a single existing ticket so it is ready | refine-ticket |
| Size work: estimate the effort on existing tickets | size-work |
| Plan a sprint from ready, sized tickets | plan-sprint |

## Output

A short line naming the capability that fits, then the handover to it. No drafting, no record, no
tracker write of its own.
