# Approvals bound to content: business

## Overview

Every approval the user gives ("post it", "apply it") is tied to a fingerprint of the exact content shown. If anything in that content changes afterwards, the fingerprint no longer matches and the approval no longer counts. This stops an edited ticket set, change set or sprint plan from being written under an old go-ahead.

## User Roles

| Role | What they do |
|---|---|
| Business user | Approves exactly what was shown |
| The plugin's writing skills | Check the fingerprint before any write |

## User Flows

| Flow | What happens |
|---|---|
| Approve | The user approves the shown content; the approval stores its fingerprint and the message that gave it. |
| Edit after approval | Any change to the content changes the fingerprint; the old approval is void and a new preview and approval are needed (AC-14, AC-34). |
| Write | Before writing, the fingerprint of the content is recomputed and must match the approved one. |

## Business Rules

| Rule | Detail |
|---|---|
| Same data, same fingerprint | The fingerprint ignores key order, so equal content always matches. |
| Any change voids | A changed word or list item gives a new fingerprint (REC-7). |
| Three things are approved | The ticket set (PUB-2), the refine change set (EDT-5) and the sprint plan (SPR-6). |
| Sizing is never approved | A size suggestion writes nothing on its own, so it carries no approval. |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Explicit approval | Approval stored with the fingerprint |
| Any record change | Stored approval dropped |
| Write attempted | Fingerprint compared; mismatch stops the write |

## Error States

| Situation | What happens |
|---|---|
| Content changed since approval | Write refused; user asked to approve again |
| Approval without the user's message reference | Refused |
| Content invalid for fingerprinting (for example not-a-number values) | Refused with an error |

## Glossary

| Term | Meaning |
|---|---|
| Digest | The content fingerprint |
| Approval binding | Tying a go-ahead to one exact digest |
| Message reference | Which user message gave the go-ahead |

Sources: shared/scripts/canonical.py, shared/scripts/record.py, REQUIREMENTS.md REC-7.
