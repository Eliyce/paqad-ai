# The Expert Roster

The detector may name **only** roster roles. They are the expert subset of the framework's
canonical `AGENT_ROLES` (`src/core/types/agent.ts`); the roster itself is derived in
`src/spec-pipeline/experts/roster.ts`, and each role's token budget comes from
`src/core/constants/budgets.ts`. Do not invent a role outside these lists — the guard rejects it.

## Standing experts (the script seats them)

Four experts sit at the table on **every** spec run, whatever you pick. You do not name them; the
script seats them for you. You may name a standing expert; it is harmless and redundant.

| Role                    | Fires when…                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `product-owner`         | Always. Who this is for, what done looks like, what is out of scope.  |
| `application-architect` | Always. Which framework piece each part becomes and where it lives.   |
| `user-flow-writer`      | Always. A user-facing path; says so when there is none, then stops.   |
| `qa-engineer`           | Always. Observable behaviour; says so when there is none, then stops. |

## On call (you pick)

| Role                    | Fires when the request touches…                                       |
| ----------------------- | --------------------------------------------------------------------- |
| `db-expert`             | The data model: a migration, a schema change, indexing, query shape.  |
| `data-modeler`          | The conceptual model: entities, relationships, normalisation choices. |
| `security-auditor`      | Auth, a trust boundary, secrets, input validation, access control.    |
| `ux-ui-analyst`         | A screen, a component, a user-facing flow or interaction.             |
| `performance-analyst`   | A hot path, a scaling concern, a latency/throughput budget.           |
| `integration-architect` | A third-party integration, an external API, a webhook or event.       |
| `solution-architect`    | A cross-cutting structural decision spanning several modules.         |
| `devops-engineer`       | Build, deploy, CI/CD, infrastructure, runtime configuration.          |
| `market-researcher`     | A product/market framing question the spec must answer first.         |

`chief-architect` is never named. It chairs every run, because the standing experts always fire.

## How to decide

- Decide from the **request and the S0 grounding slice**, not the whole repo.
- Select an expert because the work plainly sits in its domain — judge need, not self-doubt.
- Selecting nothing from the on-call list is the common, correct outcome. The standing experts are
  already seated, so an empty on-call list costs nothing downstream.
- More than one on-call expert can fire; if the request genuinely touches the database, auth, and
  the UI, name all three. There is no cap — the discipline is the trigger, not an arbitrary ceiling.
