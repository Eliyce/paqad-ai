# Answer a question with sources: API

This feature has no network or HTTP API. It is the `ask-project` entry skill, run when a user asks
what the product does. It writes no record block and never changes the tracker.

## Scripts it calls

Copied in at build time and documented in full under project-grounding
([get-the-documents API](../../../project-grounding/features/get-the-documents/api.md)):

| Script | Call | Exit |
|---|---|---|
| `scripts/check_onboarded.py` | `[--root <repo-root>]`, first; the three states read as the evidence levels | 0 ready or partly ready; 1 not set up (code-only, not a stop) |
| `scripts/find_related.py` | `--registry <modules.md> --query "<question>"` or `--modules-dir docs/modules --query "<question>"` | 0; 1 when the registry or modules folder is unreadable |
| `scripts/detect_placeholder.py` | `--path <doc.md> [--markers <file>]` | 0 |

## Reply contract

The answer first, then one Sources line and one source line for the evidence level. Any closing
offer or question comes after them, last, through the choice prompt when the host has one
(TALK-13, `references/answer-template.md`).
