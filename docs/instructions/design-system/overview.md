# Design system

This plugin has no visual UI. Its "interface" is the conversation, so its design system is the
set of conversation rules every skill follows. They are authored once under
`shared/references/` and copied into each skill at build time.

## Sources of truth

| Concern | File | Requirement |
|---|---|---|
| How replies look and sound | `shared/references/voice.md` | Section 3A, TALK-1 to TALK-15 (top priority, D-18) |
| Consultant stance | `shared/references/consulting.md` | Section 4A, CON-* |
| Plain business words, jargon deny-list | `shared/references/plain-language.md` | Section 8.4 |
| Ticket writing rules | `shared/references/writing-rules.md` | Section 8.4 |
| User stories and acceptance criteria | `shared/references/user-stories.md` | Section 8.2, TKT-6 |
| Epic and ticket shape | `skills/write-tickets/assets/epic-template.md`, `ticket-template.md` | Sections 8.1, 8.2 |
| Canonical ticket set | `skills/write-tickets/assets/ticket-set.schema.json` | Section 8.3 |
| Discovery record shape | `skills/product-discovery/assets/record-template.md` | REC-1 |

## Core rules (summary)

| Rule | Meaning |
|---|---|
| Short by default | Under about 80 words of prose per reply; questions under about 40 |
| Lead with the answer | No preamble, no restating, no closing summary |
| No narration | Never describe what the plugin is reading or thinking |
| Tables for lists | Lists, counts, steps and comparisons go in a table |
| Plain business words | No code, jargon or file paths in reply bodies; sources on one short line at the end |
| Choices in the choice prompt | Every choice through the host's choice prompt, a few words each, recommended one first and marked, reason in one clause; a list in the reply only without one |
| Question last | When a reply ends with a question, the sources line comes first and the question last |
| One-line status | "Step 3 of 6: shaping the idea." |
| Keep moving | Never ask whether to carry on between steps; stop only for a real decision |
| Silent record | The record is never offered or named; a resume file only when the user asks to stop and come back later |
| Compact previews | Ticket sets, change sets and sprint plans as one row per item; full text in a downloadable file |

## Authoring rules enforced on this repository

| Rule | Enforced by |
|---|---|
| Every `SKILL.md` opens with a "How to talk" block pointing to `references/voice.md` | `tests/scripts/test_authoring.py` (AC-13) |
| No host or vendor names under `skills/` or `shared/` | `tests/scripts/test_authoring.py` (AC-11) |
| No em dash or en dash in authored content | `tests/scripts/test_authoring.py` (AC-12) |
| Step skills say they run only when the journey directs them | `tests/scripts/test_authoring.py` |
| Choice prompt, question last, keep moving and silent record rules are present | `tests/scripts/test_conversation_feedback.py` |
| User-story reference, ticket template order, prose check of story tickets | `tests/scripts/test_user_stories.py` |

Keep these docs free of em and en dashes too, since CI-5 applies to all authored content.
