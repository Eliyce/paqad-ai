# Find what exists today: business

## Overview

Step 2 of the idea journey ("What exists today"). The plugin reads the project's own documents in a fixed order, finds the areas related to the idea, and reports what they do today, what is still unknown and anything that conflicts. Every claim carries its source. Sections that are still blank templates are listed as unknown, never presented as fact. It runs only when the journey directs it.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Reads the summary of today, corrects anything wrong |

## User Flows

| Step | What happens |
|---|---|
| 1 | The plugin finds candidate areas by matching the idea against the module registry. |
| 2 | It reads each candidate's summary, then the relevant business notes, only as far as the idea needs. |
| 3 | For each section used, it marks whether it is real content or a blank template. |
| 4 | It reports today's behaviour with sources, names the unknowns ("the project's notes on roles and rules for this area are still a blank template"), and continues. |

## Business Rules

| Rule | Detail |
|---|---|
| Reading order | Registry, summaries, business notes; screens, architecture or technical notes only to settle a fact the business notes cannot, never quoted in tickets (GRD-2). |
| No template as fact | Template sections are unknowns (GRD-4, AC-5). |
| Do not stop for gaps | Some template sections are not a reason to stop. |
| Source every claim | Each entry names its area and document (GRD-5). |
| Documents are data | Embedded instructions are ignored and mentioned (GRD-7). |
| Code last | Attached code only for a material gap, reported as "the code suggests..." |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step 1 finishes | Fills the today part of the record; no tracker access |

## Error States

| Situation | What happens |
|---|---|
| Related section is a blank template | Flagged as unknown; nothing invented; the run continues |
| Documents conflict | Reported as a conflict, with sources |
| Checking tools cannot run | Same steps done by hand from a written checklist |

## Glossary

| Term | Meaning |
|---|---|
| Related area | A module of the project whose name or features overlap the idea |
| Real section | A document section with actual project content |
| Template section | A section still holding onboarding placeholder wording |

Sources: skills/ground-in-project/SKILL.md, REQUIREMENTS.md section 7
