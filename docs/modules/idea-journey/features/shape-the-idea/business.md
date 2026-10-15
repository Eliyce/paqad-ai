# Shape the idea with options and risks: business

## Overview

Step 3 of the idea journey ("Shape it"). The plugin plays the idea back starting with the goal, looks at it through six expert lenses, offers two or three options with trade-offs, suggests a smaller first step when the idea is large or uncertain, and makes a recommendation. It raises real risks plainly, and if the idea already exists it says so with the source. It runs only when the journey directs it.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Reviews the playback, picks an option, accepts or rejects suggestions |

## User Flows

| Step | What happens |
|---|---|
| 1 | One-line status: "Step 3 of 6: shaping the idea." |
| 2 | Playback in this order: goal, what exists today (including unknowns), options with trade-offs, smaller first step where useful, recommendation. |
| 3 | Only the lenses that matter for this idea are raised, each with a recommendation. |
| 4 | Conflicts, duplicates or risks are named with evidence and a way forward. |
| 5 | The user accepts the shaping; only then is it recorded. |

| Expert lens | Typical question |
|---|---|
| Customer value and experience | Is it something customers want; is it simpler than today? |
| Business and cost | What does it cost to build and run; is there a cheaper way? |
| Operations and support | Who runs or supports it; does it add manual work or calls? |
| Data and privacy | Does it move or expose personal data? |
| Security and access | Who can reach it; does it widen access? |
| Rollout and change for existing users | What changes for people already using the product? |

## Business Rules

| Rule | Detail |
|---|---|
| Goal first | The playback starts with the goal, never a restatement of the request. |
| Lenses | All six are considered; only those that change the shape are mentioned (CON-4). |
| Business trade-offs | Time, cost, risk and effect on users, never technical reasons (CON-9). |
| Smaller first step | For large or uncertain ideas, a smaller release or an experiment with a success condition (CON-5, AC-28). |
| Already exists | Said with its source; the "already exists" outcome is recommended and nothing more is drafted unless asked (CON-8, AC-26). This also applies when the today notes hold a line the code suggests that shows it exists; that line keeps its label "the code suggests". |
| Not documented does not mean not built | An area the today notes do not document is called not documented in the playback, and nothing says or suggests it is missing, in any wording; every line from the code keeps the label "the code suggests" (GRD-8, GRD-11). |
| Privacy risk | Named plainly here with a recommendation, for example exporting customer personal data (AC-27). |
| Challenge kindly | Evidence plus a recommended way forward; an informed choice is respected and revisited only for new evidence (CON-3). |
| Suggestions labelled | Nothing enters the record until accepted (CON-6). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step 2 finishes | Fills the playback part of the record once accepted; no tracker access |

## Error States

| Situation | What happens |
|---|---|
| Idea duplicates an existing feature | Duplicate named with source, "already exists" recommended |
| Idea conflicts with current behaviour | Conflict named with evidence and a recommended way forward |
| Today's documents left unknowns | Unknowns named in the playback, not guessed past; an area with no notes is said as not documented, never said or suggested to be unbuilt |

## Glossary

| Term | Meaning |
|---|---|
| Playback | The plugin's goal-first summary of the shaped idea |
| Expert lens | A specialist viewpoint held in mind during shaping; not a separate agent |
| Smaller first step | A reduced first release or experiment that tests the riskiest assumption |

Sources: skills/shape-idea/SKILL.md, skills/shape-idea/references/playback-template.md, shared/references/paqad-docs-map.md, skills/shape-idea/references/expert-lenses.md, skills/shape-idea/references/challenge-guide.md
