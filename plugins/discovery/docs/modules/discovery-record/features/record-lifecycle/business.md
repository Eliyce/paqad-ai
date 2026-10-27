# Create, update and advance the record: business

## Overview

Web chat has no server and no memory between messages, so the plugin keeps one record per run. The record holds everything learned so far, which step the run is on, and a revision number that rises with every change. It is kept silently: it is never offered, named or described to the user. It lets the user go back a step without losing unrelated work and, when they ask to stop and come back later, take a resume file into a new chat.

## User Roles

| Role | What they do |
|---|---|
| Business user | Works through the journey; can go back, ask to stop and come back later, and resume |
| The plugin's skills | Read and write their own section of the record |

## User Flows

| Flow | What happens |
|---|---|
| Start a run | A new record is created at revision 0 and step 0, with a run id such as DR-20261005-7K2Q. |
| Finish a step | The step's section is written; the run moves on only when the step's required section is filled and current. |
| Go back | The user changes an earlier answer (for example the goal). The revision rises, later sections that depend on it are marked out of date, and everything else is kept (AC-7). |
| Stop and come back later | Only when the user asks, a resume file is offered in plain words without naming its format; where no file can be made, a chat summary to copy (REC-5, AC-72). |
| Resume | The resume file attached to a new chat resumes at the recorded step and asks nothing already answered (AC-15). |
| Existing-work modes | Refining, sizing and sprint planning use the same record with their own mode and sections. |

## Business Rules

| Rule | Detail |
|---|---|
| One record per run | The record is the plugin's only memory (REC-1). |
| Kept silently | The record and its file are never offered, named or described, at a step change or anywhere else (REC-2, TALK-15). |
| No lost updates | Every change names the revision it expects; a change based on an older revision is refused (REC-4). |
| Go back keeps unrelated work | Only sections that depend on the changed one go out of date; setup, glossary, assumptions and outcome are kept. |
| Out-of-date blocks the step | A section marked out of date must be redone before the run moves on. |
| Edits void approval | Any change to the record drops a standing approval. |
| Accepted defaults are stored | An "I don't know" answer with an accepted default is stored as an assumption (AC-29). |
| Nothing sensitive | The record never holds credentials, connector tokens or personal data the run does not need (REC-6). |
| Guides, does not enforce | The plugin guides through the record; it cannot force the model in web chat. |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Run starts | Record file created silently in the working folder where the host can create files |
| Any section written | Revision rises by one; dependent sections marked out of date if earlier work changed |
| Step finished | Step number rises; nothing about the record is shown |
| User asks to stop and come back later | Resume file offered (REC-5) |
| Approval given for a change set or sprint plan | Approval stored, tied to that exact content |

## Error States

| Situation | What happens |
|---|---|
| Change based on an old revision | Refused; the latest record must be read first |
| Change to an unknown section or to run details | Refused |
| Moving on with a missing or out-of-date section | Refused, naming the section |
| Already at the last step | Refused |
| Scripts cannot run | The same rules are kept by hand from a checklist |

## Glossary

| Term | Meaning |
|---|---|
| Record | The run's single memory file, kept silently |
| Resume file | The record handed to the user only when they ask to stop and come back later |
| Revision | A counter that rises with every change |
| Step | Where the run is in the journey (0 to 6 for building an idea) |
| Mode | build, refine, size or plan |
| Stale | Out of date because something it depended on changed |
| Going back | Changing an earlier answer mid-run |

Sources: shared/scripts/record.py, skills/product-discovery/assets/record-template.md, skills/product-discovery/SKILL.md, REQUIREMENTS.md section 6.4.
