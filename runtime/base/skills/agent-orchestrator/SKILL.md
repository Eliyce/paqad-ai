---
name: agent-orchestrator
description: 'Proves a subagent earns its place before it ships: three main-conversation baselines, a fourteen-field intake, the smallest tool list with risky powers put to the owner, hook script tests, pass^3 trials against a general-purpose agent, a delegation sweep for agents picked by their description, then the host agent file, its SDK form and a tracked record. Use when work adds or modifies a subagent definition (.claude/agents/*.md, .codex/agents/*.toml), a stage helper agent or an expert persona, when the Agent Orchestrator seat reviews one, or when paqad-ai agent status reports what comes after.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Decides whether a job deserves its own subagent and, when it does, proves that subagent before any host loads it. An agent is a separate context with its own tools, model and turn budget, so the questions are about delegation: is a fresh context worth its cost, what brief goes in and what report comes back, which tools it holds, how it stops, and whether it beats the main conversation on real tasks. Each answer is checked by a `paqad-ai agent` verb that writes one artifact into `.paqad/tmp/authoring/agents/<name>/`. The verbs never call a model: you run the baselines and trials, the verbs judge what you saved.

## Use This When

- A planned or edited file is a subagent definition: `.claude/agents/<name>.md`, `.codex/agents/<name>.toml`, or in the paqad repo a stage helper agent, plugin agent or expert persona.
- The Agent Orchestrator seat reviews a request that adds or reshapes a subagent.
- `paqad-ai agent status <name>` reports what comes after, or the owner answered a packet the agent verbs raised.

Skip it when the change removes an agent, for hosts that run no subagents, and for skill folders: a SKILL.md belongs to the skill-orchestrator.

## Inputs

- `name`: the agent name, lowercase letters, digits and single hyphens (the built-in `Explore` override is the one exception).
- `task`: the job, in the project's words, from the spec and the ticket.

## Procedure

Run `paqad-ai agent status <name>` first. For an installed agent run `paqad-ai agent improve <name>`: it snapshots the file as the `old_agent` baseline and the justification step is skipped.

1. Is a separate agent justified (`references/s0-justify.md`)? Run the task three times the way the main conversation would, each in a fresh context, save the runs and their token counts, then `paqad-ai agent justify <name> --task-file task.md --reason <key>`. Back the reason with the runs: verbose output the main thread does not need, a tool restriction, summarisable work, a cheaper model, parallel pieces or a recurring role. When the main thread, a skill or a hook is the better home (a quick change, back and forth, shared context, latency, a one-off), refuse with `--refuse <case>`; a refusal writes nothing.
2. The delegation contract (`references/s1-intake.md`). Fill the fourteen fields with `paqad-ai agent intake <name> intake.yaml`: the one job, the delegation brief the caller must send, the report template and its token cap, the smallest tool list, the model tier and effort, the stop rules (`max_turns`, `done_when`, `when_blocked`), memory, isolation, parallel, cache TTL, class, invocation (`auto` or `dispatched`) and pattern. A business field nothing answers goes to the owner with `--gap`.
3. Overlap with installed agents and experts (`references/s2-evidence.md`): write `sources.md` and run `paqad-ai agent evidence <name> sources.md`. An agent whose tools and job contain this one raises a packet.
4. The agent file (`references/s3-draft.md`). Draft it and any hook scripts outside every agents folder, with Objective, Procedure, Report, Stop when and Do not sections, map each block to S-IDs in `trace.md`, then `paqad-ai agent draft <name> --file <agent.md> --trace trace.md`. Every must-not rule that has to hold is enforced by a missing tool, a `disallowedTools` entry or a PreToolUse hook, never by prose alone.
5. Powers and hooks (`references/s4-lint-and-tests.md`). `paqad-ai agent test <name>` lints the draft (AG-001 to AG-022), puts each risky power (write tools, Bash, network, `permissionMode`, inherited tools) to the owner through `authoring.agent_permission`, and runs the hook script tests (blocks, allows, invalid input) under the project test command.
6. Task-based trials (`references/s5-evals.md`). Write cases with a repo state, inputs and expected outcomes, including an adversarial case and, for a reviewer, a clean input it must stay quiet on. Run `paqad-ai agent eval plan <name>`, run every trial it lists in a fresh context on a clean copy of the repo state, grade the end state with `references/agents/grader.md`, then `paqad-ai agent eval record <name>`. The gate is pass^3 on the cheapest passing tier, a gain over the baseline (the general-purpose agent with the same brief, or the old agent), and a cost within `agent_max_cost_multiple`. When it fails, read `references/agents/analyzer.md` and change one lever: the brief, the tools, the stop rules, the report, then the prose. Compare an edited agent with `references/agents/comparator.md`.
7. Delegation (`references/s6-delegation.md`). For an `auto` agent the host picks by its description: run `paqad-ai agent delegation plan <name> requests.json`, the sweeps and the fresh host checks, then `paqad-ai agent delegation record <name> results.json`. A `dispatched` agent is called by name, so this step is skipped.
8. Host forms (`references/s7-release.md`). `paqad-ai agent release <name>` writes the Claude file, the Codex TOML where no relied-on restriction would be lost, and the SDK form `<name>.agent.json`, with `evidence.json` and `CHANGELOG.md`. It is the only step that writes into a host agents folder.
9. In use (`references/s8-operate.md`): `learn`, `drift`, `regression`, `memory-consolidate` and `catalog`.

Checklist for one agent:

- [ ] justified against the main thread, a skill and a hook, or refused
- [ ] brief, report cap, tools and stop rules fixed in the intake
- [ ] every must-not rule enforced by a tool limit or a hook, every risky power approved by the owner
- [ ] pass^3 and cost recorded against the baseline agent
- [ ] `paqad-ai agent release` wrote the host forms and the bundle record

## Output Contract

The released agent sits in each enabled host agents folder; its SDK form, `evidence.json` and `CHANGELOG.md` are tracked under `.paqad/authoring/agents/<name>/`, and the change bundle holds `agent-<name>.json` with status `passed` or `overridden`. Report to the stage in this shape:

```markdown
Agent: <name> <version>
Gates: S0 passed, S1 passed, S2 passed, S3 passed, S4 passed, S5 passed, S6 passed or skipped
Deployable: <host yes or no, per enabled host>
Evidence: .paqad/authoring/agents/<name>/evidence.json
Decisions: <ids, or none>
```

## Escalate / Stop Conditions

- Ask the owner only through the packets the verbs raise: overlap, a risky power, a risky hook script, an intake gap, an improvement, a retirement, spend reaching its worst case, and an override. A chat message is not an owner decision.
- To skip a gate, ask with `paqad-ai agent override <name> <stage> --reason "<why>"` and record it with `--decision <id>` once the owner answers. A secret (AG-012) and a risky power can never be skipped.
- An agent that cannot pass after the revision loop is recorded as a defect and is not released.
- When the job needs the user, the agent reports `Status: BLOCKED` with the decision needed and the options; the caller raises the packet.

## Gotchas

- `paqad-ai agent test` sets `PAQAD_AGENT_UNDER_TEST` to the draft file, so the hook script tests can load it while it is still a draft.
- A trial that hits `maxTurns` or the spend cap fails; fix the stop rules first.
- Write nothing from `runtime/base/authoring/never-write.yaml`; the lint blocks every phrase on it.

## Resources

- `references/s0-justify.md`: the baseline runs, the reasons and the refusals.
- `references/s1-intake.md`: the fourteen intake fields.
- `references/s2-evidence.md`: the sources table and the overlap checks.
- `references/s3-draft.md`: the frontmatter and body rules and the trace.
- `references/s4-lint-and-tests.md`: the lint rules, powers and hook script tests.
- `references/s5-evals.md`: cases, arms, tiers, pass^k and the revision levers.
- `references/s6-delegation.md`: the delegation sweep and the fresh checks.
- `references/s7-release.md`: host forms, the SDK form, evidence and overrides.
- `references/s8-operate.md`: learn, drift, regression, memory and catalog.
- `references/agents/grader.md`: grading one trial's end state.
- `references/agents/comparator.md`: blind comparison of an edited agent.
- `references/agents/analyzer.md`: reading an iteration and picking one lever.
- `agents/openai.yaml`: the display name and short description for hosts that read it.
