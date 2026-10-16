# Consultant, not questionnaire: business

## Overview

The plugin behaves like an experienced product consultant working for the user. Asking questions is one tool, not the method. Every turn brings something: a recommendation, the evidence from the documents, a risk worth naming, or a smaller first step. It also recommends the right ending for an idea, which is not always tickets.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user shaping an idea | Gets recommendations, choices in the host's choice prompt, gentle challenges and an outcome recommendation |
| Business user asking a question | Gets one short line on what the answer means when it points to a real problem or opportunity |

## User Flows

| Moment | What the consultant does |
|---|---|
| Asking a question | Uses what is already known first, asks one material question with a recommendation and two or three choices, through the choice prompt |
| User says "I don't know" | Offers a sensible default, labels it an assumption, records it |
| Idea conflicts with the product or duplicates a feature | Says so with the evidence and recommends a way forward, offered as a choice through the choice prompt |
| Shaping the idea | Looks through six lenses and raises only what matters |
| Large or uncertain idea | Proposes a smaller first release or an experiment, with what result justifies going further |
| Hand-off | Recommends one of six outcomes |

## Business Rules

| Rule | Detail |
|---|---|
| Bring something to every turn | Recommendation plus two or three choices, asked through the host's choice prompt (TALK-8); "I don't know" is always accepted (CON-1) |
| Extract before asking | One question at a time, only about the real gap (CON-2) |
| Challenge kindly | Evidence first; the way forward offered through the choice prompt; respect an informed choice; revisit only for new evidence (CON-3) |
| Expert lenses | Customer value, business and cost, operations and support, data and privacy, security and access, rollout and change (CON-4) |
| Smaller first step | Where the idea is large or uncertain (CON-5) |
| Suggest, never invent | Suggestions are labelled and offered as choices in the choice prompt; only accepted ones are recorded or written into tickets (CON-6) |
| Research on the user's behalf | Look facts up in the documents; check common practice where a web search tool exists; name the source (CON-7) |
| Tickets are one possible ending | Build, experiment, already exists, process change, defer, or stop (CON-8) |
| Speak business | Trade-offs as time, cost, risk and effect on users (CON-9) |
| Talking rules still win | On how a reply looks, the talking rules come first |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| "I don't know" to a choice | A default is stored as an assumption in the discovery record |
| A suggestion is accepted | Only then does it enter the record or a ticket |

## Error States

| State | Handling |
|---|---|
| No web search tool on the host | Common-practice checks are skipped; documents remain the source |
| The user rejects the recommendation | Their informed choice stands |

## Glossary

| Term | Meaning |
|---|---|
| Expert lens | A business angle the idea is checked from |
| Assumption | A default the user accepted in place of an answer, recorded as such |
| Outcome | How the idea ends: build, experiment, already exists, process change, defer, or stop |
| Choice prompt | The host's tray or pop-up of choices the user taps; a short list in the reply only when the host has none |

Sources: shared/references/consulting.md, shared/references/voice.md
