# Ticket Drafting and Checking

Turns the decided idea into epics and user-story tickets (As a, I want, So that, with Given/When/Then acceptance criteria) in plain business language, then checks the set for gaps, duplicates, jargon and untestable outcomes before anything is posted.

| | |
|---|---|
| Layer | user-facing |
| Confidence | high |
| Entry skill | none (journey step) |
| Depends on | [conversation-standards](../../conversation-standards/index/summary.md), [tracker-checks](../../tracker-checks/index/summary.md), [discovery-record](../../discovery-record/index/summary.md) |
| Used by | [idea-journey](../../idea-journey/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Draft the ticket set | Builds epics and tickets from the record into the canonical `ticket-set.json` plus a compact preview (step 5, drafting half). | [business](../features/draft-tickets/business.md), [technical](../features/draft-tickets/technical.md) |
| Check the ticket set | Runs the prose and structure checks, a read-only duplicate search and the judgment checks, then fills the readiness block (step 5, checking half). | [business](../features/check-tickets/business.md), [technical](../features/check-tickets/technical.md) |

## Sources

| Path | Role |
|---|---|
| `skills/write-tickets/SKILL.md` | Drafting instructions and the no-script checklist |
| `skills/write-tickets/assets/epic-template.md` | The nine epic sections (REQUIREMENTS 8.1) |
| `skills/write-tickets/assets/ticket-template.md` | The ticket sections (REQUIREMENTS 8.2) |
| `skills/write-tickets/assets/ticket-set.schema.json` | Canonical ticket-set shape (REQUIREMENTS 8.3) |
| `skills/check-tickets/SKILL.md` | Checking instructions and the by-hand fallback |
| `skills/check-tickets/references/review-checklist.md` | The six judgment checks (REQUIREMENTS 8.5) |
| `shared/references/user-stories.md` | User-story rules imported by both skills (TKT-6, owned by conversation-standards) |
| `skills/check-tickets/scripts/check_ticket_set.py` | Structure and digest validator |

## Requirements

- TKT-1 to TKT-5: ticket writing rules (no dashes, no code words in scoped fields, no deny-list jargon, short sentences, nothing invented).
- TKT-6: every ticket is a user story with a specific role, real value, API or UI target, 2 to 8 Given/When/Then criteria, confirmed permission keys, a silent self-audit and a refusal mode.
- REQUIREMENTS 8.1 to 8.5: epic template, ticket template, canonical ticket set, checks and judgment checklist.
- REC-7: the ticket set carries a content digest that later approvals bind to.
- TALK-10, TALK-11: each skill opens with the voice reminder; previews stay compact with the full text in a file.
- AC-8: a draft with an em dash and a function name is blocked, fixes proposed, the fixed set passes.
- AC-9: similar tracker issues are shown before posting and the user decides.
- AC-16: when scripts cannot run, the checklist fallback reaches the same outcome.
- AC-47: a ticket set is previewed as a compact table plus a full preview file.
- AC-73 to AC-75: a gated feature becomes API then UI stories with a confirmed key; a no-value ticket is refused; the prose check accepts a confirmed key and flags code on story lines.
