# Post approved tickets: business

## Overview

This is the last step of the idea journey, "Hand off". The plugin first recommends the outcome that fits the idea. Only when the outcome is a build does it post the checked ticket set to the tracker. It shows the final set, waits for an explicit "post it", creates the work in a fixed order, keeps a receipt for every write so a lost reply never becomes a duplicate, reads everything back, and reports the links honestly, including partial results.

## User Roles

| Role | What they do here |
|---|---|
| Business user (idea author) | Reviews the final set, says "post it" (or not), and answers if a lost reply needs a decision about retrying. |
| The plugin | Recommends the outcome, plans and drives the posting, keeps receipts, reads back and reports. |
| Tracker | Receives the new epics, tickets and links. |

## User Flows

1. The plugin says a one-line status, for example "Step 6 of 6: handing off."
2. It recommends one outcome: build, experiment, already exists, process change, defer or stop. For anything but build, it gives a short written summary and next action, and offers to post one tracker item if wanted.
3. For a build, it shows the final set as a compact table (epics, tickets, links, labels, assignees and the target project) with the full text in a preview file.
4. The user says "post it". This approval covers exactly the content shown.
5. The plugin creates every epic, then every ticket under its epic, then the dependency links, then reads everything back.
6. It reports the links and any difference. A partial result is reported as partial.

Lost reply flow:

1. A create request gets no reply. The item is marked uncertain and every write that depends on it stops.
2. After waiting at least thirty seconds, the plugin searches the tracker by run label and item reference.
3. If found, it is recorded as created and no duplicate is made.
4. If not found, the plugin asks the user before any retry and explains that the tracker's search can lag.

## Business Rules

| Rule | Detail |
|---|---|
| Explicit approval only | "Post it" or similar. "Looks good" is not approval. |
| Approval bound to content | Approval covers the exact set shown. Any later edit voids it and needs a new preview and approval. |
| Fixed order | Epics first, then tickets with their epic as parent, then dependency links, then read-back. |
| Links done properly | Links are made only with the dedicated link action, never through an issue edit, and their direction is checked. |
| Traceable | Every created issue carries the shared label "paqad-discovery", the run label (the run ID in lowercase) and its item reference in Sources. |
| No silent retry | An uncertain create is never retried without the user's answer. |
| No rollback by deletion | A created issue is never deleted to undo a run. |
| Honest report | Partial success is reported as partial, never as done. |
| Readiness first | Posting proceeds only after the checking step reports readiness as passed. |

## Triggers and Side Effects

| Trigger | Effect |
|---|---|
| Journey reaches step 6 with readiness passed | Outcome recommendation and, for a build, the preview. |
| User says "post it" | Epics, tickets and links are created in the tracker. |
| Each write | A receipt is kept: created, uncertain or not applied. |
| Posting finishes | Each item's status and the read-back result are stored in the run's posted record; links are reported. |
| Ticket set edited after approval | Approval is void; posting refuses until a new approval. |

## Error States

| Situation | What happens |
|---|---|
| Reply lost or timed out | Item marked uncertain; dependent writes stop; reconcile by search; ask before retry. |
| Tracker refuses the parent field for a ticket under an epic | The parent is set through the tracker's additional fields instead. |
| Read-back differs from what was approved | The difference is reported with a plain next step; the result is partial. |
| Tracker cannot create issues | The export fallback is offered (see Export tickets). |
| No tool can run scripts | The same procedure is followed by hand from a checklist. |

## Glossary

| Term | Meaning |
|---|---|
| Outcome | The recommended ending: build, experiment, already exists, process change, defer or stop. |
| Receipt | The saved state of one write: in flight, created, uncertain or not applied. |
| Uncertain | A write whose reply was lost, so it is unknown whether the issue exists. |
| Run label | The run ID in lowercase, added as a tracker label to find this run's issues. |
| Read-back | Reading each created issue and comparing it with what was approved. |

Sources: skills/post-tickets/SKILL.md, skills/post-tickets/references/post-procedure.md, REQUIREMENTS.md section 9.
