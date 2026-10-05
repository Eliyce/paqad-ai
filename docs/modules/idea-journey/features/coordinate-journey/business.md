# Step order, status, resume and going back: business

## Overview

The coordinator guides an idea or problem through seven numbered steps (0 to 6), in order, as a product consultant. It keeps one record of the work so the user can download it and continue later, lets the user go back to an earlier step at any time, and answers side questions without losing its place. It guides; in web chat it cannot force the steps (section 6.5).

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
| 2. What exists today | Related areas from the project documents | today |
| 3. Shape it | Playback, lenses, options, recommendation | playback |
| 4. Decide | Open choices settled | decisions, outcome |
| 5. Draft and check | Tickets drafted and checked | ticket_set_ref, readiness |
| 6. Post | Posted on an explicit go-ahead, or a summary for other outcomes | posted |

| Flow | What happens |
|---|---|
| Moving on | A step finishes only when its part of the record is filled and current; the change is shown as one line, for example "Step 3 of 6: shaping the idea." |
| Going back | The user changes something earlier ("actually, the goal is different"). The plugin says in one line what changes, redoes only the work that depends on it, and keeps the rest. |
| Side question | Answered with sources; the run stays on its current step and the record is not changed. |
| Resume | At the end of every step the user is offered a download of the record. In a new chat with the record attached, the run continues at the recorded step and asks nothing already answered. |

## Business Rules

| Rule | Detail |
|---|---|
| Fixed order | Steps run 0 to 6 in order; each has an exit condition (REC-3). |
| Consultant stance | Every question comes with a recommendation and two or three choices; the outcome recommended may be something other than tickets (CON-1, CON-8). |
| One-line status | Step changes are one short line, never a paragraph (TALK-12, AC-48). |
| No lost updates | Every change to the record names the version it expects; a change against an older version is refused (REC-4). |
| Go back keeps unrelated work | A goal change redoes what exists today, shaping, decisions, drafts, checks and posting; setup, glossary and assumptions stay (REC-4, AC-7). |
| Edits void approval | Any change to the record drops a bound approval (REC-7). |
| No secrets in the record | The record never holds credentials, tokens or personal data the run does not need (REC-6). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| User describes an idea or problem, or accepts "turn this into an idea" | A new record is created at step 0 |
| A step finishes | Record updated; one-line status; download offered |
| User goes back | Record version rises; dependent parts marked to redo |
| Record attached in a new chat | Run resumes at the recorded step |

## Error States

| Situation | What happens |
|---|---|
| Trying to move on with a missing or out-of-date part | The move is refused until that step is redone |
| Change based on an older version of the record | Refused |
| Checking tools cannot run on this host | The same record and checks are kept by hand from a written checklist (PLG-6) |

## Glossary

| Term | Meaning |
|---|---|
| Record | The single file holding all the work so far; the plugin's only memory |
| Stale | A part of the record that depended on something the user changed and must be redone |
| Outcome | The ending the plugin recommends: build, experiment, already exists, process change, defer or stop |

Sources: skills/product-discovery/SKILL.md, skills/product-discovery/references/journey.md, REQUIREMENTS.md sections 4 and 6.4
