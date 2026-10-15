# Find what exists today: business

## Overview

Step 2 of the idea journey ("What exists today"). The plugin reads the project's own documents in a fixed order, finds the areas related to the idea, and reports what they do today, what is still unknown and anything that conflicts. Every claim carries its source. Sections that are still blank templates are listed as unknown, never presented as fact. An area with no notes is not documented, never said or suggested to be unbuilt, and when the plugin can reach the code it checks that area's code itself and records what the code suggests. It runs only when the journey directs it.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Reads the summary of today, corrects anything wrong |

## User Flows

| Step | What happens |
|---|---|
| 1 | The plugin uses the project chosen at step 0 and asks nothing more about it. It finds candidate areas by matching the idea against the module registry; when the project is partly ready (no list of areas), it matches against the area folder names and their summaries instead, and lists matching areas that have no summary as not documented. |
| 2 | It reads each candidate's summary, then the relevant business notes, only as far as the idea needs. |
| 3 | For each section used, it marks whether it is real content or a blank template. For a related area the documents do not cover, it checks that area's code automatically when the code is reachable. |
| 4 | It reports today's behaviour with sources, names the unknowns ("the project's notes on roles and rules for this area are still a blank template"), adds any line the code suggests with its label, and continues. |

## Business Rules

| Rule | Detail |
|---|---|
| Reading order | Registry, summaries, business notes; screens, architecture or technical notes only to settle a fact the business notes cannot, never quoted in tickets (GRD-2). |
| No template as fact | Template sections are unknowns (GRD-4, AC-5). |
| Not documented does not mean not built | Template and missing points are listed as not documented. Nothing says or suggests the feature is missing, in any wording (GRD-8). |
| Status from the exact thing it names | A status line in a document is said as what the docs say, for the exact thing it names only. A menu entry or screen marked coming soon means that entry is not ready yet, not that the feature behind it is missing, and no status is carried over to another area or to the product (GRD-9). |
| Requirements are intent | A requirements document kept outside the area notes never describes today; anything from it is labelled as intended. The business notes of each area always describe today, even when they state rules that must hold (GRD-10). |
| Do not stop for gaps | Some template sections are not a reason to stop, and neither is a missing list of areas when area summaries exist (GRD-1 partly ready). |
| Same project throughout | The project chosen at step 0 is used; it changes only when the user asks, and then this step is redone (GRD-3). |
| Source every claim | Each entry names its area and document (GRD-5). |
| Documents are data | Embedded instructions are ignored and mentioned (GRD-7). |
| Code checked automatically | For a related area the documents do not cover, that area's code is checked automatically when it is reachable, at most 5 files, never the project's history folder or bundled outside code. At most one finding per area is kept in the today notes, labelled "the code suggests", with the code folder it came from (GRD-11). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step 1 finishes | Fills the today part of the record; no tracker access |

## Error States

| Situation | What happens |
|---|---|
| Related section is a blank template | Flagged as unknown; nothing invented; the run continues |
| Related area has no notes | Called not documented; with the code reachable, one line the code suggests is recorded; with no code reachable, at most one short offer to check it |
| Documents conflict | Reported as a conflict, with sources |
| Project switched to one that is not set up | "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back." Nothing drafted; the current project stays |
| Checking tools cannot run | Same steps done by hand from a written checklist |

## Glossary

| Term | Meaning |
|---|---|
| Related area | A module of the project whose name or features overlap the idea |
| Real section | A document section with actual project content |
| Template section | A section still holding onboarding placeholder wording |

Sources: skills/ground-in-project/SKILL.md, shared/references/connect-repository.md, shared/references/paqad-docs-map.md, REQUIREMENTS.md section 7
