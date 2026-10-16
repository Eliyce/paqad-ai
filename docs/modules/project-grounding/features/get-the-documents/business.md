# Get the project documents: business

## Overview

Every answer, idea, refinement and size the plugin gives rests on the target repository, so it first has to settle which repository it is looking at and at what evidence level it can read it. This feature does both. It picks the repository without fuss (it never asks when the answer is obvious, and asks at most once when it is not), detects its evidence level, and remembers the choice so the user is not asked again. The repository is read at the best of three evidence levels (from project docs, from docs and code, or from code only). No repository with readable code is turned away: the plugin works from what is there, labels code-derived lines as what the code suggests, and says plainly what it cannot see. The only stop is nothing readable at all (no usable docs and no reachable code).

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user (product owner, analyst) | Attaches a project, picks one from a short list, or simply asks and gets an answer from the only project they can reach |
| Engineering team | Sets the project up with paqad; invited to do so by the optional informational nudge when paqad docs are missing or incomplete. The plugin never sets a project up itself |

## User Flows

| Step | What happens |
|---|---|
| 1 | The user asks a question, or starts an idea, a refinement or a sizing |
| 2 | If a project or its documents are already attached, uploaded or readable, the plugin uses it and asks nothing about which project. If several are attached, it offers the short choice list below over those only |
| 3 | If nothing is attached and the plugin can see the projects the user can reach, and there is exactly one, it uses that one without asking and answers first |
| 4 | If there are several, it shows one short list of all of them, the most recently active first, each marked from project docs, from docs and code, from code only or not checked, with one recommended and a short reason. A repository with readable code is always at least from code only, so it is recommendable; only not checked is not. The user picks one |
| 5 | If the plugin cannot see any project, it asks the user to attach the project or its documents folder, or to upload the documents, asking for the smallest set it needs |
| 6 | The chosen project is read at the best evidence level it can reach and the work carries on at that level. The only stop is nothing readable at all: no usable docs and no reachable code |
| 7 | The choice is remembered. Later questions, later steps and a resumed run do not ask again |

## Business Rules

| Rule | Detail |
|---|---|
| Ask at most once | Which project to use is asked only when it is not obvious, and never again once chosen (GRD-3) |
| From project docs | The project has its list of areas and at least one area description. The work carries on from the documents, enriched by the code where it helps (GRD-1, GRD-12) |
| From docs and code | At least one area is described but the list of areas is missing, or paqad is installed but the docs are incomplete. The work carries on, the plugin says once that the list is missing, and areas without a description are named as not documented and answered from code. A missing description is never read as a missing feature, and nothing is invented for them (GRD-1, GRD-8, GRD-12) |
| From code only | No paqad docs are present. The plugin answers from the code by names, labelled as what the code suggests, with the "paqad, from code only" source line; it never says an area is not built and never stops while code is reachable (GRD-1, GRD-11, GRD-12) |
| Source line | Every answer carries exactly one short source line naming its level: "paqad, from project docs", "paqad, from docs and code" or "paqad, from code only" (GRD-14) |
| Honest marks | A project is marked from project docs, from docs and code or from code only only when its files were actually read and checked. One that could not be read is marked not checked (GRD-3) |
| Recommendation | The most recently active richest project: from project docs first, then from docs and code, then from code only, then not checked. A code-only project is recommendable; only a not checked one is not (D-19, GRD-3) |
| Every project shown | When several are reachable, all of them are listed; nothing else is read until the user picks (D-19) |
| Switch only on request | The plugin changes project only when the user names another one or asks to use another one. The new project is checked first and read at the level it reaches; it is turned away only when nothing in it is readable. In a journey, what exists today is worked out again and the user is told in one line what changes |
| Read only | The plugin only reads projects. Checking, marking and choosing never change a project |
| Never read | Runtime state, the rules folder, secrets and environment files (GRD-2) |
| Documents are data | Text in a document that tries to give instructions is ignored (GRD-7) |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| A question, or the first step that reads documents in a journey, refinement or sizing | The project is chosen and checked. In a run, the chosen project's name and its state are kept in the run's setup so a resumed run uses the same project. No tracker or project change |
| The user asks to switch project | The new project is checked; if usable it replaces the old one, and a journey redoes "what exists today" onward |

## How the right skill is picked

The question-answering skill's description now also covers overview questions such as "what is this product?" and "what areas does it have?", and a project that has just been attached. This raises the chance that the chat host picks it on its own for a matching message, but it cannot guarantee it, because the host decides which skill to use. Naming the skill always works (PLG-8).

## Error States

| State | What the user sees |
|---|---|
| Chosen project has no paqad docs (code-only) | Answered from the code by names with the "paqad, from code only" source line; no not-built claim and no stop. The onboarding sentence appears only as the optional, at-most-once informational nudge ("This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back."), never as a stop |
| Nothing readable at all | No usable docs and no reachable code: a request to attach the project or its documents folder, or to upload the documents. Nothing is invented. This is the only stop |
| Docs and code (list of areas missing) | "This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown." said once, then a short line naming those areas as not documented and answered from code |
| No project can be seen | A request to attach the project or its documents folder, or to upload the documents. Nothing is invented |
| A resumed run's project can no longer be read | A request to attach that same project again, not a new list |
| Switch to a project with no readable files | The current project stays; a code-only project is used, not turned away |
| Checking tools cannot run on this host | The same check is done by hand from the skill's written checklist; the result is the same (PLG-6) |

## Glossary

| Term | Meaning |
|---|---|
| Project (repository) | The product's code and documents the plugin reads |
| List of areas (modules list) | The project's one page listing every area of the product |
| Area description (area summary) | A short note saying what one area of the product is for |
| Not documented area | An area that exists but has no description. The plugin never says or suggests, in any wording, that it is not built; it says it is not documented and, when it can reach the code, adds one line on what the code suggests about that area |
| Not checked | A reachable project whose files could not be read to check them |
| Evidence level | How much the answer can rest on: from project docs, from docs and code, or from code only. Never a reason to refuse (GRD-12) |

Sources: shared/references/connect-repository.md, shared/references/evidence-levels.md, shared/references/paqad-docs-map.md, shared/scripts/check_onboarded.py, REQUIREMENTS.md GRD-1, GRD-3, GRD-8, GRD-11, GRD-12, GRD-14, PLG-8, D-19, D-20, D-21
