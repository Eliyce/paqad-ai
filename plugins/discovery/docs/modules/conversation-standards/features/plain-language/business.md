# Plain business words: business

## Overview

Tickets and replies are read by business people, testers and developers alike. Jargon and technical shorthand get in the way. This feature is one shared list of words to avoid, each paired with the plain word to use instead. The drafting step follows it and the prose check flags any term on it with the suggested replacement.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Sees tickets and fixes written in plain words |
| Ticket reader (developer, tester) | Reads plainer ticket text |
| Plugin maintainer | Adds or changes entries in the list |

## User Flows

| Step | What happens |
|---|---|
| 1 | Tickets are drafted, or an existing ticket is refined, using the plain words |
| 2 | The prose check scans the text against the list |
| 3 | Each hit is reported with its plain replacement, for example "Use 'use' instead of 'leverage'." |
| 4 | The text is fixed and checked again until clean |

## Business Rules

| Rule | Detail |
|---|---|
| One entry, one replacement | Every listed term has a plain replacement (TKT-3) |
| Whole words, any case | "Robust" and "robust" both match; "auth" does not match inside "author" |
| Quoted evidence is safe | Quoted text, code and links are never flagged or rewritten |
| Provider-neutral and plain text | The list names no host or vendor (PLG-4) |

The list today holds 40 entries, for example leverage to use, seamless to smooth, latency to delay, endpoint to connection point, refactor to tidy up the code.

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Ticket check (step 5) or ticket refinement | Findings with suggested fixes; nothing is written to the tracker |

## Error States

| State | Handling |
|---|---|
| Scripts cannot run | The same list is applied by hand from the written checklist |
| A term is flagged inside evidence that must stay | Keep it in quotes or on the Sources line so it is read as evidence |

## Glossary

| Term | Meaning |
|---|---|
| Deny-list | The list of jargon terms to avoid |
| Replacement | The plain word suggested in place of a listed term |

Sources: shared/references/plain-language.md
