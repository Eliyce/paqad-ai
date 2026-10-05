# Suggest a size: business

## Overview

When someone asks "how big is this?", the plugin suggests a size for the ticket based on similar work the team has already finished. The suggestion is advice for the team: it is always labelled "suggested size", it comes with the reasons behind it and a confidence level, and it is never turned into a date or a promise. Nothing is written into the ticket's size field unless the user explicitly asks.

## User Roles

| Role | What they do |
|---|---|
| Product owner or business user | Asks for a size, reads the suggestion, decides whether to set it |
| Delivery team | Owns the final number; the suggestion is input to their own estimate |

## User Flows

| Step | What happens |
|---|---|
| 1. Ask | The user asks for a size ("size ABC-12", "roughly how much work is this?"). |
| 2. Find the scale | The first time, the plugin finds how the team sizes work: story points (and which field), T-shirt sizes, or nothing. If it cannot tell, it asks once and remembers the answer in the record. |
| 3. Compare | It finds similar finished tickets in the same project and uses the two to five closest, each shown with a link and its recorded size. |
| 4. Suggest | It gives a size, or a range when the comparable tickets disagree, with the drivers and a confidence of low, medium or high. |
| 5. Split advice | If the work looks bigger than a sprint's worth, or confidence is low because of size, it recommends a split and points to ticket refinement. |
| 6. Optional write | By default the suggestion is only shown, or added as a comment if asked. On "set it" the size is written to the size field. |

## Business Rules

| Rule | Detail |
|---|---|
| Always a suggestion | Every size is labelled "suggested size" and is never shown as a delivery date or commitment (EST-5, EST-7). |
| Evidence first | The suggestion rests on two to five comparable finished tickets, shown with links (EST-2). |
| No invented numbers | With fewer than two comparable tickets, no size is suggested and the plugin says so. |
| Disagreement means a range | When comparable tickets have different sizes, a range is given and confidence drops one level. |
| Template docs lower confidence | If the documents for the area are blank template text, confidence drops one level and the reason is stated (AC-36). |
| High confidence needs agreement | High confidence requires at least three comparable tickets that all have the same size. |
| Explicit write only | The size field is written only on an explicit "set it" (EST-6). |
| No silent overwrite | If the size field already has a value, the write is refused unless the user asks to replace it (AC-37). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| User asks for a size | Sizing section of the record is filled; nothing changes in the tracker |
| User says "add it as a comment" | A comment with the suggestion is added (no field change) |
| User says "set it" on an empty field | Size field is written |
| User says "set it, replace it" on a filled field | Existing size is replaced |

## Error States

| Situation | What the user sees |
|---|---|
| Fewer than two similar finished tickets | No size; a plain statement that the basis is too thin, confidence low |
| Team scale unknown | One question asking how the team sizes work |
| "Set it" on a field that already has a size | Refusal, with an offer to replace if the user wants |
| Scripts cannot run on the host | Same steps followed by hand from a checklist |

## Glossary

| Term | Meaning |
|---|---|
| Suggested size | The plugin's advice on how big the work is; not the team's estimate |
| Comparable | A finished ticket similar enough to use as evidence |
| Driver | A plain reason that pushes the size up or down |
| Confidence | Low, medium or high: how much the suggestion can be trusted |
| Scale | How the team sizes work: points, T-shirt sizes, or none |

Sources: skills/size-work/SKILL.md, skills/size-work/references/sizing-guide.md, skills/size-work/scripts/compare_sizes.py, REQUIREMENTS.md section 4D.
