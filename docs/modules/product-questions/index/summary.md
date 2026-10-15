# Product Questions

Answers a business question about what the product does today, or what the product is and what areas it has, from the target project's onboarded documents, in plain words with one Sources line, and can hand the question over to the idea journey.

| | |
|---|---|
| Layer | user-facing |
| Confidence | high |
| Entry skill | `ask-project` |
| Depends on | [project-grounding](../../project-grounding/index/summary.md), [conversation-standards](../../conversation-standards/index/summary.md) |
| Used by | None in the module map. The hand-over runs the other way: an answer can seed an [idea-journey](../../idea-journey/index/summary.md) run, but the map declares no dependency for it. |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Answer a question with sources | Chooses the project once, runs the three-state onboarded check, answers overview questions as a table of areas, reads only what the question needs, answers first with one Sources line, flags template text as unknown, calls an area the documents do not cover not documented (never stating or implying it is not built) and checks its code automatically when reachable, shows the project's term on first use | [business](../features/answer-a-question/business.md), [technical](../features/answer-a-question/technical.md) |
| Turn an answer into an idea | Adds a one-line consultant note when the answer shows a gap, and offers to carry the question into the idea journey with the answer and sources seeding the idea and today blocks | [business](../features/hand-over-to-idea/business.md), [technical](../features/hand-over-to-idea/technical.md) |

## Sources

| Path | Role |
|---|---|
| `skills/ask-project/SKILL.md` | Entry skill: trigger, procedure (GRD-1, GRD-2, GRD-3 pointer, GRD-4, GRD-6, GRD-7, GRD-8 to GRD-11 pointer, ASK-8, ASK-9, CON-9), hand-over offer, checklist fallback |
| `skills/ask-project/references/answer-template.md` | Answer shape: table or sentence, Sources line, term on first use, honesty about gaps (GRD-4, GRD-8, GRD-11) with the not documented and "the code suggests" example |

Shared files copied in at build time (declared in `build/skills.yml`, owned elsewhere): `references/voice.md`, `references/consulting.md`, `references/paqad-docs-map.md`, `references/template-markers.md`, `references/connect-repository.md`, `scripts/check_onboarded.py`, `scripts/find_related.py`, `scripts/detect_placeholder.py`.

## Requirements

| ID | Line |
|---|---|
| ASK-1 | Onboarded check first, then read in GRD-2 order, only what is needed |
| ASK-2 | Answer first in plain words or a table, then one Sources line; every fact traces to a source |
| ASK-3 | Template, missing or contradictory sections named as unconfirmed; no guess |
| ASK-4 | User's words, project term shown on first use |
| ASK-5 | One consultant line when the answer reveals a problem or opportunity (CON-9) |
| ASK-6 | Offer to carry the question into product-discovery, seeding idea and today |
| ASK-7 | Never writes to the tracker |
| ASK-8 | MUST check an area's code automatically when the documents do not cover it and the code is reachable (GRD-11), reporting at most one line per area as "the code suggests..."; never states or implies, in any wording, that an undocumented area is not built (GRD-8) |
| ASK-9 | Overview question answered as a table of areas, one line each, then one Sources line |
| GRD-1 to GRD-11 | Grounding rules applied to answers, including the three-state check (GRD-1), choosing the repository (GRD-3) and what the documents prove (GRD-8 to GRD-11) |
| TALK-1 to TALK-12 | Reply shape, via the shared voice reference |
| PLG-6, PLG-8 | Checklist fallback when scripts cannot run; entry skill that may invite direct use (its description raises but cannot guarantee automatic selection; naming the skill always works) |
