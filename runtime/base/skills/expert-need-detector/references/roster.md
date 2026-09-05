# The Expert Roster

The detector may name **only** these roles. They are the expert subset of the framework's
canonical `AGENT_ROLES` (`src/core/types/agent.ts`); the roster itself is derived in
`src/spec-pipeline/experts/roster.ts`, and each role's token budget comes from
`src/core/constants/budgets.ts`. Do not invent a role outside this list — the guard rejects it.

| Role | Fires when the request touches… |
| --- | --- |
| `db-expert` | The data model: a migration, a schema change, indexing, query shape. |
| `data-modeler` | The conceptual model: entities, relationships, normalisation choices. |
| `security-auditor` | Auth, a trust boundary, secrets, input validation, access control. |
| `ux-ui-analyst` | A screen, a component, a user-facing flow or interaction. |
| `performance-analyst` | A hot path, a scaling concern, a latency/throughput budget. |
| `integration-architect` | A third-party integration, an external API, a webhook or event. |
| `solution-architect` | A cross-cutting structural decision spanning several modules. |
| `devops-engineer` | Build, deploy, CI/CD, infrastructure, runtime configuration. |
| `market-researcher` | A product/market framing question the spec must answer first. |

## How to decide

- Decide from the **request and the S0 grounding slice**, not the whole repo.
- Select an expert because the work plainly sits in its domain — judge need, not self-doubt.
- Selecting **nothing** is the common, correct outcome. An empty roster costs nothing downstream.
- More than one expert can fire; if the request genuinely touches the database, auth, and the UI,
  name all three. There is no cap — the discipline is the trigger, not an arbitrary ceiling.
