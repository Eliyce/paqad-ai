# Module registry

Authoritative source: [docs/instructions/rules/module-map.yml](../rules/module-map.yml). This page
is a human-readable mirror; regenerate it after every map change. Module docs under
`docs/modules/` are not created yet: they wait for the map review and the
`create module documentation` stage.

## User-facing modules (skills a business user meets)

| Slug | Name | Entry skill | Features | Confidence |
|---|---|---|---|---|
| product-questions | Product Questions | `ask-project` | answer-a-question, hand-over-to-idea | high |
| idea-journey | Idea Journey | `product-discovery` | coordinate-journey, get-connected, understand-the-idea, ground-in-the-project, shape-the-idea, decide-together | high |
| ticket-drafting | Ticket Drafting and Checking | (journey step 5) | draft-tickets, check-tickets | high |
| ticket-posting | Posting to the Tracker | (journey step 6) | post-tickets, export-tickets | high |
| ticket-refinement | Ticket Refinement | `refine-ticket` | refine-a-ticket | high |
| work-sizing | Work Sizing | `size-work` | suggest-a-size | high |
| sprint-planning | Sprint Planning | `plan-sprint` | plan-a-sprint | high |

## Shared foundations (used by many modules)

| Slug | Name | Features | Confidence |
|---|---|---|---|
| discovery-record | Discovery Record | record-lifecycle, approval-digests, step-readiness-check | medium |
| project-grounding | Project Grounding | find-related-areas, detect-template-text | medium |
| conversation-standards | Conversation Standards | voice, consulting-stance, plain-language, writing-rules | medium |
| tracker-checks | Tracker Write Checks | prose-check, read-back-check, jira-profile | medium |

## Build and delivery (contributor-facing)

| Slug | Name | Features | Confidence |
|---|---|---|---|
| plugin-build | Plugin Build | assemble-dist, generate-manifests | high |
| quality-and-release | Quality and Release | unit-tests, conversation-evals, ci-pipeline, host-verification | medium |
