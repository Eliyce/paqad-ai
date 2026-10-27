# Spot unfilled template text: business

## Overview

Onboarded projects often still hold sections that were never filled in, left as the onboarding template wrote them. If the plugin read those as facts, it would repeat instructions such as "Describe the business purpose of the ..." as if they were product truth. This feature checks every section of a document separately and marks it real or template, so the plugin can say plainly what the documents cannot confirm and carry on with the rest.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Told which points the project's notes cannot confirm, for example "the notes on roles and rules for this area are still a blank template" |
| Engineering team | Learns which documents still need filling in |

## User Flows

| Step | What happens |
|---|---|
| 1 | A related area's document is read |
| 2 | The document is split into sections by heading |
| 3 | Each section is checked for the known template phrases |
| 4 | Real sections are used as sourced facts; template sections are listed as unknown |
| 5 | The work continues with the unknowns carried forward |

## Business Rules

| Rule | Detail |
|---|---|
| Per section, not per document | One document can hold both real and template sections, and both are reported (GRD-4) |
| Never present template text as fact | A template section is named as unconfirmed, never quoted as behaviour (GRD-4) |
| Do not stop for templates | Template sections do not halt the run; they become open points (GRD-4) |
| Both template generations | Phrases from the current and the earlier paqad template are recognised |
| No guessing | A gap is never filled with an invented answer (ASK-3, AC-5, AC-22) |
| Template is not absence | A template or missing section only means the point is not documented. It is never evidence that the feature is missing, and the plugin never says or suggests it is not built, in any wording (GRD-8). When the code is reachable, that area's code is checked and at most one point per area is added, labelled "the code suggests" (GRD-11) |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Answering a question, or step 2 of the idea journey | Each relied-on section is marked real or template; the "what exists today" notes record this per area |

No change to the project or the tracker.

## Error States

| State | What the user sees |
|---|---|
| A needed section is template | A plain line naming what the documents cannot confirm |
| Scripts cannot run on the host | The same check is done by hand against the written list of template phrases |

## Glossary

| Term | Meaning |
|---|---|
| Template text | Wording left by the onboarding template that was never replaced with real content |
| Marker phrase | A known template sentence opening, used to recognise template text |
| Real section | A section with none of the marker phrases |

Sources: shared/scripts/detect_placeholder.py, shared/references/template-markers.md, shared/references/paqad-docs-map.md
