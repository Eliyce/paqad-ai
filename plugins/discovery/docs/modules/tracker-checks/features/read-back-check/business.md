# Read back what was written: business

## Overview

A tracker can accept a request and still store something different, or quietly drop a link. After posting, each created issue is read back and compared with the set the user approved. Small formatting differences are ignored; real differences are reported. A run where only some issues match is reported as partial, never as done.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Gets the links to what was created and any difference in plain words, with a next step |
| Skill (post-tickets) | Runs the comparison after the last write |

## User Flows

| Step | What happens |
|---|---|
| 1 | The approved set is posted in order |
| 2 | Each created issue is read back from the tracker |
| 3 | Title, type, parent, labels, links, the item reference in Sources, and body text are compared after normalising |
| 4 | The result is match, partial or mismatch, with each difference listed |
| 5 | The user is told what was created and what, if anything, differs |

## Business Rules

| Rule | Detail |
|---|---|
| Compare against the approved set | Not against a later draft (PUB-6) |
| Ignore formatting noise | Whitespace, list markers, escaping and letter case in bodies and titles do not count |
| Extra labels are fine | An approved label must be present; additional labels such as the run label are allowed |
| Links must match exactly | Every dependency link, and no others |
| Honest result | Any difference with at least one match is partial; none matching is mismatch |
| Nothing is undone | The check only reads; it never deletes or edits |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Posting finishes (step 6) | The read-back result is stored with the posted issues and reported to the user |

## Error States

| State | What the user hears |
|---|---|
| An approved item was not created | Named as missing |
| A created item differs | Named, with the fields that differ |
| An issue was created that was not approved | Named as extra |
| Scripts cannot run | Each created issue is read back and compared by hand |

## Glossary

| Term | Meaning |
|---|---|
| Read-back | Reading what the tracker now holds and comparing it with what was approved |
| Item reference | The run ID plus the item's reference, for example "DR-20261005-7K2Q / E1-T2", written in each issue's Sources section |
| Partial | Some issues match and some do not |

Sources: shared/scripts/check_readback.py
