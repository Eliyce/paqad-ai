# The Expert Roster

verified: 2026-11-01

The detector may name **only** roster roles. They are the expert subset of the framework's
canonical `AGENT_ROLES` (`src/core/types/agent.ts`); the roster itself is derived in
`src/spec-pipeline/experts/roster.ts`, and each role's token budget comes from
`src/core/constants/budgets.ts`. Do not invent a role outside these lists: the guard rejects it.

## Standing experts (the script seats them)

Four experts sit at the table on **every** spec run, whatever you pick. You do not name them; the
script seats them for you. You may name a standing expert; it is harmless and redundant.

| Role                    | Fires when…                                                           | Owns                                                 |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| `product-owner`         | Always. Who this is for, what done looks like, what is out of scope.  | Who is it for and what does done mean?               |
| `application-architect` | Always. Which framework piece each part becomes and where it lives.   | Which framework piece does each part become?         |
| `user-flow-writer`      | Always. A user-facing path; says so when there is none, then stops.   | Which steps does a person take from start to finish? |
| `qa-engineer`           | Always. Observable behaviour; says so when there is none, then stops. | What observable behaviour proves it works?           |

## On call (you pick)

| Role                    | Fires when the request touches…                                                                          | Owns                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `db-expert`             | The data model: a migration, a schema change, indexing, query shape.                                     | Will the migration, index and query shape hold up?                   |
| `data-modeler`          | The conceptual model: entities, relationships, normalisation choices.                                    | Which entities exist and how do they relate?                         |
| `security-auditor`      | Auth, a trust boundary, secrets, input validation, access control.                                       | Who may do this, and can an attacker abuse it?                       |
| `ux-ui-analyst`         | A screen, a component, a user-facing flow or interaction.                                                | Can a user see and operate this screen?                              |
| `performance-analyst`   | A hot path, a scaling concern, a latency/throughput budget.                                              | Does this stay fast under real load?                                 |
| `integration-architect` | A third-party integration, an external API, a webhook or event.                                          | How do we talk to the outside service safely?                        |
| `solution-architect`    | A cross-cutting structural decision spanning several modules.                                            | How do several modules fit together across this change?              |
| `devops-engineer`       | Build, deploy, CI/CD, infrastructure, runtime configuration.                                             | How is it built, deployed and configured?                            |
| `market-researcher`     | A product/market framing question the spec must answer first.                                            | Is there a market reason to build it?                                |
| `skill-orchestrator`    | A new or changed skill (a SKILL.md or a skill folder) in any host's skills folder.                       | Should this skill exist, and what grounds it?                        |
| `agent-orchestrator`    | A new or changed agent (subagent file) in any host's agents folder, or a stage or expert agent of paqad. | Should this agent exist, and how is it briefed, limited and stopped? |

`chief-architect` is never named. It chairs every run, because the standing experts always fire.

## How to decide

- Decide from the **request and the S0 grounding slice**, not the whole repo.
- Select an expert because the work plainly sits in its domain: judge need, not self-doubt.
- Selecting nothing from the on-call list is the common, correct outcome. The standing experts are
  already seated, so an empty on-call list costs nothing downstream.
- More than one on-call expert can fire; if the request genuinely touches the database, auth, and
  the UI, name all three. There is no cap: the discipline is the trigger, not an arbitrary ceiling.
