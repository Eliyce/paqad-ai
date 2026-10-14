# Get the project documents: business

## Overview

Every answer, idea, refinement and size the plugin gives rests on the project's own documents, so it first has to settle which project it is looking at and whether that project's documents can be used. This feature does both. It picks the project without fuss (it never asks when the answer is obvious, and asks at most once when it is not), checks how far the project is set up, and remembers the choice so the user is not asked again. A project whose list of areas is missing but whose areas are described is no longer turned away; the plugin works from what is there and says plainly what it cannot see.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user (product owner, analyst) | Attaches a project, picks one from a short list, or simply asks and gets an answer from the only project they can reach |
| Engineering team | Sets the project up with paqad; asked to do so when a project is not set up. The plugin never sets a project up itself |

## User Flows

| Step | What happens |
|---|---|
| 1 | The user asks a question, or starts an idea, a refinement or a sizing |
| 2 | If a project or its documents are already attached, uploaded or readable, the plugin uses it and asks nothing about which project. If several are attached, it offers the short choice list below over those only |
| 3 | If nothing is attached and the plugin can see the projects the user can reach, and there is exactly one, it uses that one without asking and answers first |
| 4 | If there are several, it shows one short list of all of them, the most recently active first, each marked ready, partly ready, not set up or not checked, with one recommended and a short reason. The user picks one |
| 5 | If the plugin cannot see any project, it asks the user to attach the project or its documents folder, or to upload the documents, asking for the smallest set it needs |
| 6 | The chosen project is checked in full. Ready or partly ready: the work carries on. Not set up: the plugin says so and offers any other project that was marked ready or partly ready |
| 7 | The choice is remembered. Later questions, later steps and a resumed run do not ask again |

## Business Rules

| Rule | Detail |
|---|---|
| Ask at most once | Which project to use is asked only when it is not obvious, and never again once chosen (GRD-3) |
| Ready | The project has its list of areas and at least one area description. The work carries on as normal (GRD-1) |
| Partly ready | The list of areas is missing but at least one area is described. The work carries on, the plugin says once that the list is missing, and areas without a description are named as unknown. Nothing is invented for them (GRD-1) |
| Not set up | No area is described, whatever else the project holds. The plugin stops with the onboarding message and drafts or answers nothing (GRD-1) |
| Honest marks | A project is marked ready only when its documents were actually read and checked. One that could not be read is marked not checked, never ready (GRD-3) |
| Recommendation | The most recently active ready project; if none, the most recently active partly ready one; if neither, the most recently active not checked one. A project that is not set up is never recommended (D-19) |
| Every project shown | When several are reachable, all of them are listed; nothing else is read until the user picks (D-19) |
| Switch only on request | The plugin changes project only when the user names another one or asks to use another one. The new project is checked first; if it is not set up, the current one stays. In a journey, what exists today is worked out again and the user is told in one line what changes |
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
| Chosen project not set up | "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back." Then one short line offering any project marked ready or partly ready, ready first. Nothing drafted or answered |
| Every reachable project not set up | The same onboarding message alone, with no list |
| Partly ready project | "This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown." said once, then a short line naming those areas |
| No project can be seen | A request to attach the project or its documents folder, or to upload the documents. Nothing is invented |
| A resumed run's project can no longer be read | A request to attach that same project again, not a new list |
| Switch to a project that is not set up | The onboarding message; the current project stays |
| Checking tools cannot run on this host | The same check is done by hand from the skill's written checklist; the result is the same (PLG-6) |

## Glossary

| Term | Meaning |
|---|---|
| Project (repository) | The product's code and documents the plugin reads |
| List of areas (modules list) | The project's one page listing every area of the product |
| Area description (area summary) | A short note saying what one area of the product is for |
| Unknown area | An area that exists but has no description, so the plugin says nothing about it beyond its name |
| Not checked | A reachable project whose documents could not be read to check them |

Sources: shared/references/connect-repository.md, shared/scripts/check_onboarded.py, REQUIREMENTS.md GRD-1, GRD-3, PLG-8, D-19, D-20
