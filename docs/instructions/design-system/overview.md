# Design system

This plugin has no visual UI. Its "interface" is the conversation, so its design system is the
set of conversation rules every skill follows. They are authored once under
`shared/references/` and copied into each skill at build time.

## Sources of truth

| Concern | File | Requirement |
|---|---|---|
| How replies look and sound | `shared/references/voice.md` | Section 3A, TALK-1 to TALK-12 (top priority, D-18) |
| Consultant stance | `shared/references/consulting.md` | Section 4A, CON-* |
| Plain business words, jargon deny-list | `shared/references/plain-language.md` | Section 8.4 |
| Ticket writing rules | `shared/references/writing-rules.md` | Section 8.4 |
| Epic and ticket shape | `skills/write-tickets/assets/epic-template.md`, `ticket-template.md` | Sections 8.1, 8.2 |
| Canonical ticket set | `skills/write-tickets/assets/ticket-set.schema.json` | Section 8.3 |
| Discovery record shape | `skills/product-discovery/assets/record-template.md` | REC-1 |

## Core rules (summary)

| Rule | Meaning |
|---|---|
| Short by default | Under about 80 words of prose per reply; questions under about 40 |
| Lead with the answer | No preamble, no restating, no closing summary |
| No narration | Never describe what the plugin is reading or thinking |
| Tables for lists | Lists, counts, steps, options and comparisons go in a table |
| Plain business words | No code, jargon or file paths in reply bodies; sources on one short line at the end |
| Short choices | A few words each, recommended one marked, reason in one clause |
| One-line status | "Step 3 of 6: shaping the idea." |
| Compact previews | Ticket sets, change sets and sprint plans as one row per item; full text in a downloadable file |

## Authoring rules enforced on this repository

| Rule | Enforced by |
|---|---|
| Every `SKILL.md` opens with a "How to talk" block pointing to `references/voice.md` | `tests/scripts/test_authoring.py` (AC-13) |
| No host or vendor names under `skills/` or `shared/` | `tests/scripts/test_authoring.py` (AC-11) |
| No em dash or en dash in authored content | `tests/scripts/test_authoring.py` (AC-12) |
| Step skills say they run only when the journey directs them | `tests/scripts/test_authoring.py` |

Keep these docs free of em and en dashes too, since CI-5 applies to all authored content.
