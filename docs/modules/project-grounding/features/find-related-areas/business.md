# Find related areas: business

## Overview

Before the plugin answers a question or explores an idea, it has to know which parts of the product are involved. This feature takes the user's own words, compares them with the project's list of areas, and returns the most likely areas first. It also fixes the order in which the project's documents are read, so the plugin reads only what is needed and always starts with the business notes.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user (product owner, analyst) | Indirectly: the answer or the "what exists today" step is built from the areas this feature picks |
| Engineering team | Owns the onboarded documents this feature reads; asked to onboard the project when it is missing |

## User Flows

| Step | What happens |
|---|---|
| 1 | The user asks a question or describes an idea |
| 2 | The project is confirmed as set up (onboarded) before anything else is read |
| 3 | The idea or question is compared with every area in the project's list; areas that share words are ranked, most overlap first |
| 4 | The plugin reads, in order: the area list, each candidate's summary, then its business notes; screens and journeys, architecture and technical notes only to settle a point; attached code last |
| 5 | Reading stops as soon as the documents answer the point |

## Business Rules

| Rule | Detail |
|---|---|
| Set up first | A project counts as set up only when it has its area list and at least one area summary. Otherwise the plugin stops and asks for the engineering team to onboard it (GRD-1) |
| Fixed reading order | Business notes come before technical notes; technical and architecture notes are never quoted in ticket text (GRD-2) |
| Never read | Runtime state, the rules folder, secrets and environment files (GRD-2) |
| Same input, same result | The same list and the same words always give the same ranking; ties keep the order of the list |
| Every fact is sourced | Each fact taken from a document carries its document on one Sources line (GRD-5) |
| Code is last | Code is read only when attached and the documents left a real gap, and is reported as what the code suggests |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| A question (answering) or step 2 of the idea journey | A ranked list of candidate areas; no change to the project or the tracker |

## Error States

| State | What the user sees |
|---|---|
| Project not set up | The onboarding message; nothing else happens |
| Area list missing or unreadable | The ranking stops with an error; a missing list is normally caught earlier by the set-up check |
| No area shares any word with the request | No candidates; the plugin says what the documents cannot confirm |
| Scripts cannot run on the host | The same ranking is done by hand, following the written checklist in the skill |

## Glossary

| Term | Meaning |
|---|---|
| Onboarded | The project has been prepared with paqad documentation the plugin can read |
| Area (module) | A part of the product listed in the project's area list, with a plain name and features |
| Candidate area | An area that shares at least one word with the user's request |

Sources: shared/scripts/find_related.py, shared/references/paqad-docs-map.md
