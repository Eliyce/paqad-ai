# Find related areas: business

## Overview

Before the plugin answers a question or explores an idea, it has to know which parts of the product are involved. This feature takes the user's own words, compares them with the project's list of areas (or, when that list is missing, with the area folders and their summaries), and returns the most likely areas first. It also fixes the order in which the project's documents are read, so the plugin reads only what is needed and always starts with the business notes, and it sets what those documents can and cannot prove.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user (product owner, analyst) | Indirectly: the answer or the "what exists today" step is built from the areas this feature picks |
| Engineering team | Owns the onboarded documents this feature reads; asked to onboard the project when it is missing |

## User Flows

| Step | What happens |
|---|---|
| 1 | The user asks a question or describes an idea |
| 2 | The project's set-up state is checked before anything else is read (see Get the project documents) |
| 3 | The idea or question is compared with every area in the project's list; areas that share words are ranked, most overlap first. When the project is partly ready (no list), it is compared with each described area's name and summary instead |
| 4 | The plugin reads, in order: the area list, each candidate's summary, then its business notes; screens and journeys, architecture and technical notes only to settle a point; for an area the documents do not cover, that area's code last, automatically when the code is reachable |
| 5 | Reading stops as soon as the documents answer the point |

## Business Rules

| Rule | Detail |
|---|---|
| Set up first | Ready: the area list and at least one area summary. Partly ready: summaries but no list; the ranking works from the summaries and areas without one are named as not documented. Not set up: no summary at all; the plugin stops and asks for the engineering team to onboard it (GRD-1) |
| Fixed reading order | Business notes come before technical notes; technical and architecture notes are never quoted in ticket text (GRD-2) |
| Never read | Runtime state, the rules folder, secrets and environment files (GRD-2) |
| Same input, same result | The same list (or the same folders and summaries) and the same words always give the same ranking; ties keep the order of the list, or the alphabetical order of the area folders |
| Every fact is sourced | Each fact taken from a document carries its document on one Sources line (GRD-5) |
| Not documented does not mean not built | A missing summary, a missing document or unfilled template text never shows that a feature is missing. The area is called not documented, and nothing may say or suggest the feature is missing, in any wording; "not built", "none yet" or "doesn't exist" are only examples (GRD-8) |
| Status needs evidence about the exact thing it names | Built, coming soon or placeholder is said only from evidence about that exact area or item. A status line in a document covers only the exact thing it names: a menu entry or screen marked coming soon means that entry is not ready yet, not that the feature behind it is missing. It is said as what the docs say, because documents can lag the product, and is never carried over to another area, to the feature behind a menu entry or to the whole product. No area's status is worked out from another area's documents or screens. When the docs and the code disagree, both are said plainly and neither is picked as fact (GRD-9) |
| Requirements are intent, not today | A requirements or specification document kept outside the area notes is not in the reading order and is never used to say what the product does today. When one is already in hand, or the user asks about plans, it is only quoted as what is intended. The business notes of each area always describe today, even when they state rules that must hold (GRD-10) |
| Code is checked automatically | For an area the answer needs that the documents do not cover, that area's code is checked automatically when it is reachable: names first, then at most 5 files, and no file for a row in an overview table. It never looks in the project's history folder or in bundled outside code. At most one line per area, labelled "the code suggests". When no code is found under the area's name, the area is still not documented, never not built. When the code is not reachable, the plugin offers once to check it (GRD-11) |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| A question (answering) or step 2 of the idea journey | A ranked list of candidate areas; no change to the project or the tracker |

## Error States

| State | What the user sees |
|---|---|
| Project not set up | The onboarding message; nothing else happens |
| Area list missing or unreadable | When the list is missing the ranking works from the area summaries instead (partly ready); an unreadable list given to the ranking stops it with an error |
| No area has a summary | The ranking stops with an error rather than returning an empty list; this is normally caught earlier, because such a project is not set up |
| No area shares any word with the request | No candidates; the plugin says what the documents cannot confirm |
| Scripts cannot run on the host | The same ranking is done by hand, following the written checklist in the skill |

## Glossary

| Term | Meaning |
|---|---|
| Onboarded | The project has been prepared with paqad documentation the plugin can read |
| Area (module) | A part of the product listed in the project's area list, with a plain name and features, or a folder under the project's modules folder |
| Candidate area | An area that shares at least one word with the user's request |

Sources: shared/scripts/find_related.py, shared/scripts/check_onboarded.py, shared/references/paqad-docs-map.md
