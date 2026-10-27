# Step order, status, resume and going back: business

## Overview

The coordinator guides an idea or problem through seven numbered steps (0 to 6), in order, as a product consultant. It keeps one record of the work silently, never offering or naming it, so the user can stop and continue later in a new chat, keeps moving from step to step without asking whether to carry on, lets the user go back to an earlier step at any time, and answers side questions without losing its place. It guides; in web chat it cannot force the steps (section 6.5).

## User Roles

| Role | What they do here |
|---|---|
| Business user | Describes an idea or problem, answers questions, goes back or resumes |
| Step skills | Do the work of each step; the coordinator keeps the place and the memory |

## User Flows

| Step the user sees | What happens | Fills |
|---|---|---|
| 0. Get connected | Documents and tracker checked | setup |
| 1. Your idea | Goal, who benefits, success, constraints | idea |
| 2. What exists today | Related areas at the best evidence level (project docs, docs and code, or code only) | today |
| 3. Shape it | Playback, lenses, options, recommendation | playback |
| 4. Decide | Open choices settled | decisions, outcome |
| 5. Draft and check | Tickets drafted and checked | ticket_set_ref, readiness |
| 6. Post | Posted on an explicit go-ahead, or a summary for other outcomes | posted |

| Flow | What happens |
|---|---|
| Moving on | A step finishes only when its part of the record is filled and current; the change is shown as one line, for example "Step 3 of 6: shaping the idea.", and the next step's work follows in the same reply. The plugin never asks whether to carry on; it stops only for a real decision (a choice, an approval or a missing fact). |
| Going back | The user changes something earlier ("actually, the goal is different"). The plugin says in one line what changes, redoes only the work that depends on it, and keeps the rest. |
| Side question | Answered with sources; the run stays on its current step and the record is not changed. |
| Stop and come back later | The record is never offered at a step change. Only when the user says they want to stop and come back later is a resume file offered in plain words, without naming its format (where no file can be made, a chat summary to copy). In a new chat with that file attached, the run continues at the recorded step and asks nothing already answered. |

## Business Rules

| Rule | Detail |
|---|---|
| Fixed order | Steps run 0 to 6 in order; each has an exit condition (REC-3). |
| Consultant stance | Every question comes with a recommendation and two or three choices, asked through the host's choice prompt with the recommended one first and marked (a short list in the reply only when the host has none); the outcome recommended may be something other than tickets (CON-1, CON-8). |
| One-line status | Step changes are one short line, never a paragraph (TALK-12, AC-48). |
| Keep moving | No pause to ask whether to carry on between steps (TALK-14, AC-71). |
| Question last | A reply that ends with a question puts the sources line first and the question last (TALK-13, AC-70). |
| Silent record | The record and its file are never offered, named or described; a resume file is offered only on request (TALK-15, REC-5, AC-72). |
| No lost updates | Every change to the record names the version it expects; a change against an older version is refused (REC-4). |
| Go back keeps unrelated work | A goal change redoes what exists today, shaping, decisions, drafts, checks and posting; setup, glossary and assumptions stay (REC-4, AC-7). |
| Edits void approval | Any change to the record drops a bound approval (REC-7). |
| No secrets in the record | The record never holds credentials, tokens or personal data the run does not need (REC-6). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| User describes an idea or problem, or accepts "turn this into an idea" | A new record is created at step 0 |
| A step finishes | Record updated silently; one-line status; the next step starts at once |
| User says they want to stop and come back later | A resume file offered in plain words |
| User goes back | Record version rises; dependent parts marked to redo |
| Resume file attached in a new chat | Run resumes at the recorded step |

## Error States

| Situation | What happens |
|---|---|
| Trying to move on with a missing or out-of-date part | The move is refused until that step is redone |
| Change based on an older version of the record | Refused |
| Checking tools cannot run on this host | The same record and checks are kept by hand from a written checklist (PLG-6) |

## Glossary

| Term | Meaning |
|---|---|
| Record | The single file holding all the work so far; the plugin's only memory, kept silently |
| Resume file | The record given to the user only when they ask to stop and come back later |
| Choice prompt | The host's tray or pop-up of choices the user taps |
| Stale | A part of the record that depended on something the user changed and must be redone |
| Outcome | The ending the plugin recommends: build, experiment, already exists, process change, defer or stop |

Sources: skills/product-discovery/SKILL.md, skills/product-discovery/references/journey.md, shared/references/voice.md, REQUIREMENTS.md sections 3A, 4 and 6.4
