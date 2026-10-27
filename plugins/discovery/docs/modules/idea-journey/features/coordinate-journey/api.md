# Step order, status, resume and going back: API

This feature has no network or HTTP API. It is the `product-discovery` entry skill, which runs
the journey when a user describes an idea or problem. Its programmatic interface is the shared
record script, copied in at build time as `scripts/record.py` and `scripts/check_record.py`
(owned by discovery-record; full contract in the
[record-lifecycle API](../../../discovery-record/features/record-lifecycle/api.md)).

## How the journey uses the scripts

| Moment | Call | Result |
|---|---|---|
| A new idea or problem | `record.py init --path <f> --mode build` | Record at revision 0, step 0 |
| A step's work is accepted | `record.py update --path <f> --expect-revision <n> --patch <patch.json>` | Block written; `reverted` when going back staled later work |
| A step finishes | `check_record.py --path <f> --step <n>`, then `record.py advance --path <f> --expect-revision <n>` | Step rises only when its required blocks are present and not stale |
| Resume from a resume file | `record.py show --path <f>`, `check_record.py --path <f>` | Recorded step confirmed in one line; what still needs redoing |

Exit codes: 0 on success; 1 on a refused write or a reported issue; 2 on an argument error.

## Conversation contract

Each step change is one status line followed at once by the next step's work, with no question
about carrying on (TALK-12, TALK-14). The record is written silently and never offered or named;
a resume file is offered only when the user asks to stop and come back later (TALK-15, REC-5).
