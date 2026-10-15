# Script and authoring tests: business

## Overview

The plugin's safety rests on its scripts: the record that refuses stale writes, the digest that voids an approval after an edit, the posting plan that never retries blindly, the read-back. These tests prove each of those behaviours on every pull request, and also check that every skill is written to the house rules. They are the main evidence that the plugin does what the requirements say.

## User Roles

| Role | Interest |
|---|---|
| Delivery lead or product owner | Each script-provable acceptance scenario has a named, passing test |
| Contributor | Runs the suite before raising a change |
| CI | Runs the suite on every pull request |

## User Flows

| Step | What happens |
|---|---|
| 1 | A contributor runs the suite locally, or CI runs it on a pull request |
| 2 | Each script is tested against fixtures in temporary folders; nothing outside them is written |
| 3 | The authoring tests read the source tree and fail on any rule break |
| 4 | A failure blocks the pull request check |

## Business Rules

| What is proven | Examples of acceptance scenarios covered |
|---|---|
| Discovery record | Stale revision refused; going back marks only dependent work stale (AC-7); assumptions stored (AC-29); edits void approvals; resume signal (AC-15) |
| Ticket checks | Dash and function name blocked and fixed (AC-8); every structure failure caught |
| Posting | Order, parents and links (AC-13); lost replies reconciled or asked about (AC-11, AC-12); edit after approval voids it (AC-14); both link tool names (AC-18); read-back; CSV export |
| Refining, sizing, sprint | AC-31 to AC-34, AC-35 to AC-37, AC-38 to AC-41 |
| Grounding | Onboarded check in its three states (ready, partly ready, not set up) with both exact messages (AC-1, AC-56); unreadable documents never crash the check; deterministic module ranking from the list of areas or, when it is missing, from the area summaries; template sections flagged |
| Choosing the project | One shared rule for choosing the project, shipped into exactly the skills that read documents; the question skill's description stays within the host limits |
| Build | Four manifests agree; byte-identical builds; undeclared shared import fails; no forbidden folders |
| Authoring rules | Skill names and sizes; "How to talk" block; no vendor names; no long dashes; entry versus step skill wording (AC-19); checklist fallback in every script-bearing skill (AC-16) |

Standard library only, Python 3.9 or later, no network. Last measured: 312 tests, 0 failures.

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Pull request, or manual CI run | Pass or fail on the CI-7 step; no files changed |

## Error States

| State | Meaning |
|---|---|
| A test fails | The pull request check fails |
| Not checked yet | 90% branch coverage and the standard-library-only import rule (both part of CI-7) are not enforced |

## Glossary

| Term | Meaning |
|---|---|
| Unit test | An automated check of one script or rule |
| Authoring rule | A rule about how skills are written, checked by reading the files |
| Script-proven | An acceptance scenario proven by a unit test rather than a conversation |

Sources: tests/scripts/
