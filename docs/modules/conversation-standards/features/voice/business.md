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
| A question | The answer on the first line, then one short Sources line; any closing question or offer comes after the Sources line, last |
| A list, count, steps or comparison | A table |
| A yes or no question | One or two sentences, no table, no headings |
| A choice to make | The host's choice prompt (the tray or pop-up the user taps): a few short options, the recommended one first and marked, the reason in one clause. A short list in the reply only when the host has no choice prompt |
| A step change | One line, for example "Step 3 of 6: shaping the idea.", then the next step's work at once, never a question about carrying on |
| Wanting to stop and come back later | A resume file offered in plain words, its format not named; the record is otherwise never mentioned |
| A ticket set, change set or sprint plan to approve | A compact table in chat; the full text in a downloadable file where possible |
| "How" or "why" | Only then, a brief explanation |

## Business Rules

| Rule | Detail |
|---|---|
| Short by default | Under about 80 words of prose per reply; a question under about 40 words plus its choices (TALK-1) |
| No explaining unless asked | Give the fact, not the background (TALK-2) |
| Tables when they make sense | Lists, counts, steps, comparisons; choices to pick from go in the choice prompt, not a table (TALK-3) |
| Lead with the answer | No preamble, no restating, no closing summary (TALK-4) |
| No narration | Never describe what the plugin is reading or thinking (TALK-5) |
| Plain business words | No jargon, code or file paths in the body; sources on one line at the end (TALK-6) |
| Detail on request | Offer more in one short line at most (TALK-7) |
| Choices in the choice prompt | Every choice (a question with options, a challenge's way forward, suggested measures, a decision, an approval) goes through the host's choice prompt, the recommended one first and marked; the top ones go in with a write-in when there are more, and a typed answer counts. Never a table or list of choices in the reply when the prompt is available (TALK-8) |
| Talk like a person | Warm and direct, no emoji, no sign-offs (TALK-9) |
| Remind every skill | Every skill opens with the "How to talk" block (TALK-10) |
| Previews stay compact | One row per item in chat; approval still covers the full content (TALK-11) |
| Status in one line | Never a paragraph (TALK-12) |
| Question last | The Sources line and source line first, the question the very last thing, through the choice prompt (TALK-13) |
| Keep moving | Never ask permission to continue between steps; stop only for a real decision (TALK-14) |
| The record stays silent | Never offer, name or describe the record or its file; a resume file only when the user asks to stop and come back later (TALK-15) |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Any reply from any skill | Shaped by these rules; nothing is written anywhere |

## Error States

| State | Handling |
|---|---|
| The host cannot create files | The full preview text is given in chat instead |
| The host has no choice prompt | The choices are shown as a short list in the reply, the recommended one marked, with the question as the last line after the sources |
| A rule is broken in a reply | Not blocked at run time; the conversation scenarios are written to catch it once they run (not yet run in CI) |

## Glossary

| Term | Meaning |
|---|---|
| Sources line | One short line at the end naming the documents a reply drew on |
| Compact preview | A table with one row per item, used in place of full text in chat |
| How to talk block | The short reminder at the top of every skill that points to these rules |
| Choice prompt | The host's tray or pop-up of choices the user taps |
| Resume file | The record handed over only when the user asks to stop and come back later |

Sources: shared/references/voice.md
