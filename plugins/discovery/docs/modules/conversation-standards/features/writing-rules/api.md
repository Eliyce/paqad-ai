# Ticket writing rules: API

This feature has no network or HTTP API and no script of its own. It is instruction text held once in `shared/references/writing-rules.md` (imported by
`write-tickets` and `refine-ticket`) and `shared/references/user-stories.md` (imported by
`write-tickets` and `check-tickets`), copied into each declaring skill at build time.

## Contract the skills consume

| Rule | Content |
|---|---|
| TKT-1 | No em or en dash used as a dash anywhere in ticket text |
| TKT-2 | No code words in the title, goal, user story lines (As a, I want, So that) or acceptance criteria; a confirmed permission key in inline code (`can <verb> <noun>`) is the one allowed code span |
| TKT-3 | No jargon from the `plain-language.md` deny-list |
| TKT-4, TKT-5 | Short sentences; nothing invented |
| TKT-6 | Every ticket a user story: specific role, capability, real outcome, API or UI target, 2 to 8 Given/When/Then criteria, confirmed permission key, silent self-audit, refusal when there is no user value |

## Enforcement interface

The rules a script can test are enforced by `check_prose.py` (TKT-1 to TKT-3, finding codes
`TKT1`, `TKT2`, `TKT3`), documented under
[prose-check](../../../tracker-checks/features/prose-check/technical.md). The 2 to 8 criteria bound
is enforced by `check_ticket_set.py` (code `DONE_WHEN`, see
[check-tickets API](../../../ticket-drafting/features/check-tickets/api.md)). The story shape is a
judgment check.
