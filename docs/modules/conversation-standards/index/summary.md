# Conversation Standards

Sets how every reply looks and sounds, the consultant stance the plugin takes, the plain business words it uses, and the rules every epic and ticket is written to.

| | |
|---|---|
| Layer | shared-foundation |
| Confidence | medium |
| Entry skill | none (shared) |
| Depends on | none |
| Used by | [product-questions](../../product-questions/index/summary.md), [idea-journey](../../idea-journey/index/summary.md), [ticket-drafting](../../ticket-drafting/index/summary.md), [ticket-posting](../../ticket-posting/index/summary.md), [ticket-refinement](../../ticket-refinement/index/summary.md), [work-sizing](../../work-sizing/index/summary.md), [sprint-planning](../../sprint-planning/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Short, plain replies | The fifteen talking rules every skill follows, including choices in the host's choice prompt, question last, keep moving and the silent record; top priority over any other guidance | [business](../features/voice/business.md), [technical](../features/voice/technical.md) |
| Consultant, not questionnaire | CON-1 to CON-9: bring a recommendation, challenge kindly, look through expert lenses, recommend the right ending | [business](../features/consulting-stance/business.md), [technical](../features/consulting-stance/technical.md) |
| Plain business words | The jargon deny-list with a plain replacement for each term | [business](../features/plain-language/business.md), [technical](../features/plain-language/technical.md) |
| Ticket writing rules | The rules every epic and ticket follows: no dashes, no code words (a confirmed permission key allowed), no jargon, short sentences, nothing invented, and every ticket a user story with Given/When/Then acceptance criteria | [business](../features/writing-rules/business.md), [technical](../features/writing-rules/technical.md) |

## Sources

| Path | Role |
|---|---|
| `shared/references/voice.md` | Section 3A talking rules; imported by all 13 skills |
| `shared/references/consulting.md` | Section 4A consultant stance; imported by `product-discovery` and `ask-project` |
| `shared/references/plain-language.md` | TKT-3 deny-list; imported by `write-tickets`, `check-tickets`, `refine-ticket`, and read by `check_prose.py` |
| `shared/references/writing-rules.md` | Section 8.4 ticket writing rules; imported by `write-tickets`, `refine-ticket` |
| `shared/references/user-stories.md` | Section 8.2 user-story rules (TKT-6); imported by `write-tickets`, `check-tickets` |

These are instruction text only; no script lives in this module. The checks that enforce parts of them live in [tracker-checks](../../tracker-checks/index/summary.md) (prose check) and `tests/scripts/test_authoring.py` (voice block).

## Requirements

- TALK-1 to TALK-15: how the plugin talks (section 3A, top priority).
- CON-1 to CON-9: consulting stance (section 4A).
- TKT-1 to TKT-5: ticket writing rules (section 8.4), including the deny-list behind TKT-3.
- TKT-6: user-story shape (section 8.2).
- PLG-4: provider-neutral shared text.
- PLG-9: held once under `shared/` and copied into each declaring skill.
- AC-25 to AC-29, AC-42 to AC-48, AC-68 to AC-72: conversation scenarios for the stance and the talking rules.
- AC-8: em dash and code word blocked in a draft (prose check, using these rules).
