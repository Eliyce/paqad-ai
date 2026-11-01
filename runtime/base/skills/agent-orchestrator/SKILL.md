---
name: agent-orchestrator
description: Takes a new or edited agent (a subagent file, a paqad stage agent or an expert persona) through paqad's nine gated stages, from proving a separate agent is needed to releasing it with task-based evals and evidence, so no agent is added on a hunch. Use when a change creates or edits a file in a host agents folder, a paqad stage or expert agent, when the Agent Orchestrator sits at the High Table, or when paqad-ai agent status names a stage to run next.
model_tier: reasoning
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  name:
    type: string
    required: true
    description: The agent name, lowercase and hyphenated, equal to its file name.
  task:
    type: string
    required: true
    description: The job the agent is for, taken from the frozen spec and the ticket.
---

## What It Does

Runs the agent pipeline for one agent during the development stage. Each stage is a `paqad-ai agent` verb that writes one artifact into the workspace `.paqad/tmp/authoring/agents/<name>/`, and each gate reads only that artifact. A stage refuses to start while an earlier gate fails and names the command to run. The verbs never call a model: you do the runs and the writing, the verbs check what you produced.

## Use This When

- A planned or edited file is an agent path: `.claude/agents/<name>.md`, `.codex/agents/<name>.toml`, or in the paqad repo a stage agent, plugin agent or expert persona.
- `paqad-ai agent status <name>` names the next stage.
- The owner answered a decision this pipeline raised and the waiting stage can resume.

Skip it for an agent the change removes, and for files under a host that runs no subagents.

## Inputs

- `name`: the agent name. The verbs refuse any name outside lowercase letters, digits and single hyphens (the one built-in override, `Explore`, is the exception).
- `task`: the job, in the project's words, from the spec and the ticket.

## Procedure

The workspace is `.paqad/tmp/authoring/agents/<name>`. Each step names the reference to read before you run it.

1. Run `paqad-ai agent status <name>`. For an installed agent run `paqad-ai agent improve <name>` first: it snapshots the agent as the `old_agent` baseline and S0 is skipped.
2. S0 justify (`references/s0-justify.md`). Run the task three times in the main conversation shape, each in a fresh context, save the runs and their verdicts, then `paqad-ai agent justify <name> --task-file task.md --reason <key>`. A refusal (a quick change, back and forth, shared context, latency, a one-off, a skill or a hook would do) writes nothing.
3. S1 intake (`references/s1-intake.md`). Fill the fourteen fields, then `paqad-ai agent intake <name> intake.yaml`. A business field nothing answers goes to the owner with `--gap`.
4. S2 evidence (`references/s2-evidence.md`). Write `sources.md` and run `paqad-ai agent evidence <name> sources.md`. An overlap with an installed agent or an expert raises a packet.
5. S3 draft (`references/s3-draft.md`). Draft the agent file and its hook scripts outside every agents folder, map each block to S-IDs in `trace.md`, then `paqad-ai agent draft <name> --file <agent.md> --trace trace.md`.
6. S4 lint and tests (`references/s4-lint-and-tests.md`). Run `paqad-ai agent test <name>`. It lints the draft, asks the owner about risky powers through `authoring.agent_permission`, and runs the hook script tests under the project test command.
7. S5 evals (`references/s5-evals.md`). Write the cases, run `paqad-ai agent eval plan <name>` and every trial it prints in a fresh context, grade with `references/agents/grader.md`, then `paqad-ai agent eval record <name>`. The gate is pass^3 against the baseline on the cheapest tier that passes.
8. S6 delegation (`references/s6-delegation.md`). For an agent the model picks by its description, run `paqad-ai agent delegation plan <name> requests.json`, the sweeps, then `paqad-ai agent delegation record <name> results.json`. A dispatched agent skips S6.
9. S7 release (`references/s7-release.md`). Run `paqad-ai agent release <name>`. It is the only step that writes the agent into a host agents folder.
10. S8 operate, later and in use (`references/s8-operate.md`): learn, drift, regression, memory-consolidate and catalog.

Checklist for one pass:

- [ ] status read, entry known (improve snapshot taken for an installed agent)
- [ ] three fresh-context baseline runs judged, or a refusal recorded
- [ ] every gate passed, or the owner recorded an override
- [ ] `paqad-ai agent release` wrote the bundle record

## Output Contract

The released agent sits in each enabled host agents folder, with its SDK form `<name>.agent.json`, `evidence.json` and `CHANGELOG.md` tracked under `.paqad/authoring/agents/<name>/`. The change bundle holds `agent-<name>.json` with status `passed` or `overridden`. Report to the stage in this shape:

```markdown
Agent: <name> <version>
Gates: S0 passed, S1 passed, S2 passed, S3 passed, S4 passed, S5 passed, S6 passed or skipped
Deployable: <host yes or no, per enabled host>
Evidence: .paqad/authoring/agents/<name>/evidence.json
Decisions: <ids, or none>
```

## Escalate / Stop Conditions

- Ask the owner only through the decision packets the verbs raise: overlap, a risky power, a risky hook script, an intake gap, an improvement, a retirement, the spend reaching its worst case, and an override. A message in chat is not an owner decision.
- To skip a gate, ask with `paqad-ai agent override <name> <stage> --reason "<why>"` and record it with `--decision <id>` after the owner answers. A secret (AG-012) and a risky power can never be skipped.
- A gate the agent cannot pass after the revision loop is recorded as a defect; the agent is not released.
- When the job needs the user, the agent reports `Status: BLOCKED` with the decision needed and the options; the caller raises the packet.

## Gotchas

- `paqad-ai agent test` sets `PAQAD_AGENT_UNDER_TEST` to the draft file, so the hook script tests can load it while it is still a draft.
- A rule that must never break belongs in a hook the agent names, not only in its prose.
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
- `references/agents/grader.md`: the brief for grading one S5 trial.
- `references/agents/comparator.md`: the blind comparison of an edited agent.
- `references/agents/analyzer.md`: the brief for reading an S5 iteration.
- `agents/openai.yaml`: the display name and short description for hosts that read it.
