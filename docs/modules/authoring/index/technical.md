# Skill and Agent Authoring: technical notes

The [summary](summary.md) lists the stages and their gates. This page covers the parts that are
easy to get wrong: which orchestrator does what, the agent settings, the permission decision, the
delegation log and the Explore offer.

## Two orchestrators, two skills

The Skill Orchestrator (`runtime/base/skills/skill-orchestrator`) and the Agent Orchestrator
(`runtime/base/skills/agent-orchestrator`) are separate skills with separate High Table seats.
The skill one judges whether a reusable instruction set belongs in the catalog and runs
`paqad-ai skill`. The agent one judges whether a job needs its own subagent (its own context,
tools, model tier and report shape) and runs `paqad-ai agent`. A change that touches both kinds of
path seats both. Neither skill covers the other's work, and the Agent Orchestrator answers "a skill
would do" when a job needs no separate context.

## Agent verbs

All verbs live under `paqad-ai agent`: `justify`, `intake`, `evidence`, `draft`, `lint`, `test`,
`eval plan`, `eval record`, `delegation plan`, `delegation record`, `release`, `override`,
`improve`, `status`, `learn`, `drift`, `regression`, `memory-consolidate` and `catalog`.
`agent lint` and `agent status` take `--json`. Each stage verb refuses to run until the stage
before it passed or was overridden.

## Settings

The eleven agent keys sit in the policy group under "Skill and agent authoring". An out-of-range
value falls back to the default and `paqad-ai doctor` names it.

| Key | Default | What it controls |
| --- | --- | --- |
| `agent_orchestrator_enabled` | `true` | the seat, the pipeline, the lane raise, the completion check and the delegation log |
| `agent_pass_k_threshold` | `0.9` | pass^3 an agent needs at S5 |
| `agent_stage_pass_k_threshold` | `0.95` | pass^3 a stage agent needs at S5 |
| `agent_delegation_threshold` | `0.9` | validation score the description needs at S6 |
| `agent_description_max_tokens` | `300` | longest allowed description |
| `agent_report_max_tokens` | `2000` | longest report an agent should return |
| `agent_prompt_max_tokens` | `3000` | longest agent body |
| `agent_max_tools` | `10` | tools an agent may list before lint flags it |
| `agent_max_cost_multiple` | `4` | how many times the baseline cost an agent may spend |
| `agent_catalog_description_max_tokens` | `15000` | combined description budget across installed agents |
| `agent_memory_max_lines` | `200` | longest agent memory file |

## Risky powers need a decision

When the only blocking lint findings on a draft are risky powers (a broad permission mode, a
large tool list or no tool list at all), `agent test` raises one `authoring.agent_permission`
decision naming the powers and the file hash. S4 waits until you resolve it. The approval is
tied to the agent text and its hook scripts, so it still holds after release and expires when
either changes; `agent catalog` and the end-of-change check name an expired approval.

## Delegation log

The delegation hook writes one line per Agent or Task call and per SubagentStop to
`.paqad/ledger/authoring/delegations.jsonl`. It records metadata only: the agent name, request
and session ids, time, tokens, duration and status, never the prompt or the report. The ledger
folder is git-ignored, so each machine keeps its own log. The hook runs on Claude Code only,
prints nothing and never blocks. `agent catalog` reads it to show each agent's last use and the
agents nobody has called.

## The cheaper Explore offer

On a project whose host lets a project agent replace a built-in one (Claude Code), onboarding
prints one offer line to build a cheaper `Explore` agent on the fast tier, unless
`.claude/agents/Explore.md` already exists or the orchestrator is off. Taking it runs
`paqad-ai agent intake Explore --preset explore`. Release refuses the override unless it reaches
pass^3 of 0.9 at a lower cost than the built-in agent, and on other hosts it is recorded as not
deployable with nothing written.
