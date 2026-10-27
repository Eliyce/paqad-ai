# Plan a sprint: business

## Overview

When someone asks to "plan the next sprint", the plugin proposes a sprint plan for the team's planning meeting. It works out how much the team can take on, keeps only tickets that are ready, and suggests which ones fit in the user's priority order. It acts as a consultant: the team decides. Tickets are moved into the sprint only after the user says "apply it" for that exact plan.

## User Roles

| Role | What they do |
|---|---|
| Product owner or business user | Asks for the plan, points to the ordered backlog, gives or confirms capacity, approves |
| Delivery team | Decides in its planning meeting; the plan is a proposal |
| Scrum master | Creates, starts and closes sprints in the tracker; the plugin never does |

## User Flows

| Step | What happens |
|---|---|
| 1. Find the sprint | The plugin finds the next future sprint, or the one the user names. If there is none, it says so and stops (AC-41). |
| 2. Find capacity | It asks for capacity, or offers one derived from the last three completed sprints, labelled "derived" and shown with each sprint's number (AC-38). |
| 3. Filter readiness | Starting from the user's ordered backlog, it keeps tickets that pass the ticket checks, have a size, and whose dependencies are done or in the same sprint. Others are listed with what each needs (AC-39). |
| 4. Propose | It shows a goal, the tickets that fit in priority order, stretch tickets, what was left out and why, the total against capacity, and the risks. |
| 5. Trade-offs | When things do not fit, it offers trade-offs; the user decides. |
| 6. Apply | On "apply it" for that exact plan, it puts only the chosen tickets into the sprint, checks each one landed, and reports honestly, including partial results (AC-40). |

## Business Rules

| Rule | Detail |
|---|---|
| Never invent capacity | Capacity comes from the user or from the last three completed sprints, with the numbers shown (SPR-2). |
| Ready means ready | A ticket needs passing checks, a size, and resolved dependencies (SPR-3). |
| Unready is listed, not dropped | Each unready ticket appears with its gap so it can go to refinement or sizing. |
| Priority order | Fitting tickets follow the user's priority order within capacity. |
| Stretch | Tickets that would take the total up to a quarter over capacity are offered as stretch, not committed. |
| Exact approval | Approval covers that exact plan; any edit to the plan voids it (SPR-6). |
| Chosen tickets only | Only the chosen tickets get the sprint; nothing else changes. |
| Hard limits | The plugin never creates, starts, closes, renames or reorders a sprint, never reorders the backlog or board, and changes the sprint goal field only when the user asks for exact text (SPR-7). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| User asks to plan a sprint | Sprint plan section of the record is filled; nothing changes in the tracker |
| User says "apply it" for the shown plan | Sprint field set on the chosen tickets only, then read back |
| Sprint field cannot be set by the connector | Plan handed over as a by-hand list (U-14) |

## Error States

| Situation | What the user sees |
|---|---|
| No future sprint exists | A plain note that the team creates sprints in the tracker; nothing created |
| Plan changed after approval | Apply refused; a new approval is needed |
| Some tickets did not land in the sprint | Honest partial report naming what is missing |
| Sprint field not settable | The full ordered plan as a list to apply by hand |
| Fewer than three past sprints | Flagged as a risk on the derived capacity |
| Scripts cannot run on the host | Same steps followed by hand from a checklist |

## Glossary

| Term | Meaning |
|---|---|
| Capacity | How much work the team can take on in the sprint |
| Derived capacity | Capacity worked out from recent finished sprints, shown with its numbers |
| Ready | Passes checks, has a size, dependencies resolved |
| Stretch | Tickets that only fit if the sprint runs ahead |
| By-hand list | The plan as a list for the user to apply in the tracker themselves |

Sources: skills/plan-sprint/SKILL.md, skills/plan-sprint/references/sprint-procedure.md, skills/plan-sprint/scripts/fit_sprint.py, REQUIREMENTS.md section 4E.
