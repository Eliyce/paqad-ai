# Module registry

Authoritative source: [docs/instructions/rules/module-map.yml](../rules/module-map.yml). This page
is a human-readable mirror; regenerate it after every map change. Each module's docs live under
`docs/modules/<slug>/` (an `index/summary.md`, plus `business.md` and `technical.md` per feature).

## User-facing modules (skills a business user meets)

| Slug | Name | Entry skill | Features | Confidence | Docs |
|---|---|---|---|---|---|
| product-questions | Product Questions | `ask-project` | answer-a-question, hand-over-to-idea | high | [summary](../../modules/product-questions/index/summary.md) |
| idea-journey | Idea Journey | `product-discovery` | coordinate-journey, get-connected, understand-the-idea, ground-in-the-project, shape-the-idea, decide-together | high | [summary](../../modules/idea-journey/index/summary.md) |
| ticket-drafting | Ticket Drafting and Checking | (journey step 5) | draft-tickets, check-tickets | high | [summary](../../modules/ticket-drafting/index/summary.md) |
| ticket-posting | Posting to the Tracker | (journey step 6) | post-tickets, export-tickets | high | [summary](../../modules/ticket-posting/index/summary.md) |
| ticket-refinement | Ticket Refinement | `refine-ticket` | refine-a-ticket | high | [summary](../../modules/ticket-refinement/index/summary.md) |
| work-sizing | Work Sizing | `size-work` | suggest-a-size | high | [summary](../../modules/work-sizing/index/summary.md) |
| sprint-planning | Sprint Planning | `plan-sprint` | plan-a-sprint | high | [summary](../../modules/sprint-planning/index/summary.md) |

## Shared foundations (used by many modules)

| Slug | Name | Features | Confidence | Docs |
|---|---|---|---|---|
| discovery-record | Discovery Record | record-lifecycle, approval-digests, step-readiness-check | medium | [summary](../../modules/discovery-record/index/summary.md) |
| project-grounding | Project Grounding | get-the-documents, find-related-areas, detect-template-text | medium | [summary](../../modules/project-grounding/index/summary.md) |
| conversation-standards | Conversation Standards | voice, consulting-stance, plain-language, writing-rules | medium | [summary](../../modules/conversation-standards/index/summary.md) |
| tracker-checks | Tracker Write Checks | prose-check, read-back-check, jira-profile | medium | [summary](../../modules/tracker-checks/index/summary.md) |

## Build and delivery (contributor-facing)

| Slug | Name | Features | Confidence | Docs |
|---|---|---|---|---|
| plugin-build | Plugin Build | assemble-dist, generate-manifests | high | [summary](../../modules/plugin-build/index/summary.md) |
| quality-and-release | Quality and Release | unit-tests, conversation-evals, ci-pipeline, host-verification | medium | [summary](../../modules/quality-and-release/index/summary.md) |
