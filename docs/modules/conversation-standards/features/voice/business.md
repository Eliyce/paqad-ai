# Short, plain replies: business

## Overview

The people using the plugin are experts in their product. Long AI replies are the most common complaint, so brevity is treated as a product requirement, not a style choice. This feature is the single set of talking rules every skill follows, and it wins over any other guidance when they pull in different directions.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Every reply they read follows these rules |
| Skill author | Every skill must open with a short "How to talk" reminder pointing to these rules |

## User Flows

| Situation | What the user gets |
|---|---|
| A question | The answer on the first line, then one short Sources line |
| A list, count, steps or comparison | A table |
| A yes or no question | One or two sentences, no table, no headings |
| A choice to make | A few short options, the recommended one marked, the reason in one clause |
| A step change | One line, for example "Step 3 of 6: shaping the idea." |
| A ticket set, change set or sprint plan to approve | A compact table in chat; the full text in a downloadable file where possible |
| "How" or "why" | Only then, a brief explanation |

## Business Rules

| Rule | Detail |
|---|---|
| Short by default | Under about 80 words of prose per reply; a question under about 40 words plus its choices (TALK-1) |
| No explaining unless asked | Give the fact, not the background (TALK-2) |
| Tables when they make sense | Lists, counts, steps, options, comparisons (TALK-3) |
| Lead with the answer | No preamble, no restating, no closing summary (TALK-4) |
| No narration | Never describe what the plugin is reading or thinking (TALK-5) |
| Plain business words | No jargon, code or file paths in the body; sources on one line at the end (TALK-6) |
| Detail on request | Offer more in one short line at most (TALK-7) |
| Short choices | Recommended choice marked (TALK-8) |
| Talk like a person | Warm and direct, no emoji, no sign-offs (TALK-9) |
| Remind every skill | Every skill opens with the "How to talk" block (TALK-10) |
| Previews stay compact | One row per item in chat; approval still covers the full content (TALK-11) |
| Status in one line | Never a paragraph (TALK-12) |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Any reply from any skill | Shaped by these rules; nothing is written anywhere |

## Error States

| State | Handling |
|---|---|
| The host cannot create files | The full preview text is given in chat instead |
| A rule is broken in a reply | Not blocked at run time; the conversation scenarios are written to catch it once they run (not yet run in CI) |

## Glossary

| Term | Meaning |
|---|---|
| Sources line | One short line at the end naming the documents a reply drew on |
| Compact preview | A table with one row per item, used in place of full text in chat |
| How to talk block | The short reminder at the top of every skill that points to these rules |

Sources: shared/references/voice.md
