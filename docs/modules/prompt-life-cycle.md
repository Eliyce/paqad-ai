# Prompt Life Cycle (Research)

> **Status:** research-only · not a canonical module doc · do not commit.
>
> Deep analysis of what happens between a user typing a prompt into an LLM
> client (Claude Code, Codex, Cursor, …) and that prompt landing as real
> development output in this repo. Scoped to the Paqad framework wired in
> via `CLAUDE.md` → `.paqad/framework-path.txt` → `~/.paqad-ai/current`.

## 1. Mental Model

A prompt is not "sent to the model." It is **assembled** into a much
larger request by the adapter (Claude Code CLI, Codex, etc.), then routed
inside the agent runtime by Paqad's rules. The journey has three big arcs:

1. **Ingress** — raw user text becomes a structured request with system
   prompts, tool schemas, project rules, and memory attached.
2. **Routing & gating** — the runtime classifies intent, picks a workflow
   or skill, checks capabilities/strictness, and may pause for a Decision
   Packet.
3. **Execution & egress** — tools run (Read/Edit/Bash/Agent/…), output is
   validated against rules (module map, stack, design system), and the
   result is rendered back to the user as code, docs, or chat.

## 2. Stage-by-Stage Table

| #  | Stage                              | Who runs it                                                  | Input                                                              | What actually happens                                                                                                                                                                                                                                              | Output                                            | Key artifacts / files                                                 |
|----|------------------------------------|--------------------------------------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------|-----------------------------------------------------------------------|
| 1  | **Keystroke → prompt buffer**      | Adapter UI (Claude Code TUI, Cursor chat, Codex CLI)         | Raw user text + optional file mentions, slash command, image paste | UI captures input, expands `@file` mentions, resolves `/slash` to a skill name, attaches drag-dropped images as content blocks                                                                                                                                     | A draft user-turn message with text + attachments | terminal/IDE process memory                                           |
| 2  | **Session bootstrap**              | Adapter                                                      | Working directory, git status, env                                 | Adapter reads `CWD`, detects git repo + branch, captures recent commits, OS/shell/model id, today's date. Loads `settings.json`, `settings.local.json`, hooks, permission rules                                                                                    | A `<env>` block + permission policy               | `.claude/settings*.json`, hooks                                       |
| 3  | **CLAUDE.md resolution**           | Adapter                                                      | `CWD/CLAUDE.md`                                                    | Reads project `CLAUDE.md`. Here it instructs: open `.paqad/framework-path.txt`, resolve `~/.paqad-ai/current`, load rules + stack + design-system + workflows                                                                                                                  | Framework entrypoint resolved                     | `CLAUDE.md`, `.paqad/framework-path.txt`, `~/.paqad-ai/current/base/` |
| 4  | **Framework rule load**            | Adapter / agent runtime                                      | Framework path                                                     | Loads `docs/instructions/rules` (coding, content, security, `module-map.yml`), `docs/instructions/stack` (overview, versions), `docs/instructions/design-system`. These become high-priority system context                                                        | Project contract attached to system prompt        | `docs/instructions/rules/**`, `docs/instructions/stack/**`            |
| 5  | **Memory recall**                  | Adapter                                                      | `memory/MEMORY.md` + linked files                                  | Auto-memory index loaded into context (≤ ~200 lines). Memory files referenced by `[[name]]` may be fetched. Distinguishes user / feedback / project / reference memories                                                                                           | Persistent user + project facts                   | `memory/MEMORY.md`, `memory/*.md`                                     |
| 6  | **Skill & subagent registry**      | Agent runtime                                                | Skill manifests, agent definitions                                 | Available skills + subagents announced via `<system-reminder>` (descriptions only — schemas deferred). Some tools are deferred and only loaded on `ToolSearch` to keep context lean                                                                                | Skill/agent menu                                  | `runtime/base/agents/*`, skill manifests                              |
| 7  | **Request assembly**               | Adapter                                                      | Stages 1–6                                                         | Builds the final API request: system prompt (env + CLAUDE.md + rules + memory + skill list) ‖ tool schemas (Read, Edit, Bash, Agent, Skill, AskUserQuestion, …) ‖ user turn ‖ any prior conversation. Applies prompt caching breakpoints to keep TTL warm          | Anthropic Messages API payload                    | in-memory only                                                        |
| 8  | **Model inference**                | Anthropic API                                                | Assembled payload                                                  | LLM (Opus 4.7 here) produces a turn. Output is a stream of text blocks + `tool_use` blocks. Thinking blocks may precede, hidden from user. Cache hits short-circuit repeated prefixes                                                                              | Assistant turn with tool calls                    | network                                                               |
| 9  | **Intent classification (router)** | Paqad router agent (logical layer inside the model turn)     | User text + framework rules                                        | Short Paqad phrases (`create documentation`, `run health`, `create feature`) are recognized as **workflow invocations**, not generic chat. Otherwise the request is treated as ad-hoc engineering                                                                  | A target workflow id or "freeform"                | `agent-routing`, `runtime/base/agents/router.md`                      |
| 10 | **Capability & strictness gating** | `agent-routing` / `capability-model`                         | Workflow id + repo capabilities                                    | Checks which lanes are enabled (content / coding / security). Strictness flags can promote the task to the full lane: adversarial review, blocks on stale docs, mandatory module-map sync                                                                          | Allowed agents + required gates                   | `src/core/capabilities.ts`, `agent-routing`                           |
| 11 | **Workflow selection**             | `workflow-engine`                                            | Intent + capabilities                                              | Picks the matching workflow doc (e.g. `documentation-workflow`, `feature-development-workflow`, `root-cause-analysis-workflow`, `pentest-workflow`). The workflow doc is loaded as additional procedural context                                                   | Step list + required artifacts                    | `docs/modules/*-workflow/index/summary.md`                            |
| 12 | **Context intelligence / RAG**     | `context-intelligence`, `hybrid-rag`, `cli-rag`              | Workflow + working set                                              | Optional accelerator on top of the grep/read default — OFF unless `rag_enabled`. When on, a background worker keeps the index fresh and writes precomputed docs-first slices into the session-context artifact; the seam injects them next prompt (stale-while-revalidate). Capped top-k, above a similarity floor, marked advisory. Off / cold / weak-match → nothing injected, agent greps exactly as today. Code slices and per-prompt querying are later phases | A handful of advisory doc slices (or nothing)     | `cli-rag`, `hybrid-rag`, `context-seam`, `module-map-engine`          |
| 13 | **Decision Pause check**           | `decision-pause-contract`                                    | Proposed actions                                                   | If the next move is a "pause-worthy" choice (architectural, naming, scope), the agent writes `.paqad/decisions/pending/D-{id}.json` and **stops**. UI surfaces options via `AskUserQuestion`. Execution only resumes once `D-{id}.json` exists in `resolved/`        | Either a resolved decision or a hard stop         | `.paqad/decisions/pending/**`, `.paqad/decisions/resolved/**`         |
| 14 | **Plan / Task graph**              | TaskCreate                                                  | Resolved decisions + workflow steps                                | For non-trivial work the agent builds a task list (TaskCreate). Each task tracks state independently. For exploratory turns this stage is skipped                                                                                                                  | Ordered task list                                 | task store                                                            |
| 15 | **Tool execution**                 | Adapter                                                      | `tool_use` blocks                                                  | Each tool call goes through permission mode → user prompt (if not allowed) → hook → execution. Read/Edit/Write touch files; Bash runs shell with sandbox + timeout; Agent spawns subagents (Explore, Plan, general-purpose, code-reviewer …) with isolated context | `tool_result` blocks back into the model loop     | hooks, sandbox                                                        |
| 16 | **Subagent fan-out**               | `Agent` tool                                                 | Self-contained prompt                                              | Subagents start with **no** memory of parent context. Prompt must brief them cold. They return a single message. Parent must verify their claims against actual diffs                                                                                              | Summary string                                    | subagent transcripts                                                  |
| 17 | **Compliance / health checks**     | `compliance-engine`, `module-health-ledger`, `rules-runtime` | Touched files + diff                                               | Validates against `docs/instructions/rules/**`, module-map, stack versions, design-system. Generates ledger entries. Stale docs or missing module-map entries can block in strict lanes                                                                            | Pass/fail + ledger update                         | `cli-health`, `cli-compliance`, `module-health-ledger`                |
| 18 | **Output rendering**               | Adapter                                                      | Final assistant turn                                               | Text rendered as CommonMark in monospace. File references become clickable `[path](path)` links. Diffs and tool calls are shown inline. Hidden thinking is omitted                                                                                                 | Visible chat output                               | terminal/IDE                                                          |
| 19 | **Persistence side-effects**       | Adapter / Paqad                                              | Result                                                             | Files saved on disk; git stays dirty until user commits. Memory may be updated (user role, feedback, project facts). Decision Packets move pending→resolved. Session transcript stored                                                                             | Durable repo + memory state                       | working tree, `memory/**`, `.paqad/decisions/resolved/**`             |
| 20 | **Next-turn priming**              | Adapter                                                      | Stage 19 + new user input                                          | On the next prompt, only the **delta** is sent; the cached prefix (env, rules, memory) is reused if within the 5-minute cache TTL. Otherwise the prefix is re-billed. Long sessions trigger automatic compression                                                  | Warm context for stage 7                          | prompt cache                                                          |

### Host-surface support for context injection (RAG / seam)

Stage 12's precomputed slices only reach the model on a host that actually
**executes `UserPromptSubmit` hooks** and forwards their stdout — the seam has no
other way in. Coverage is therefore per *surface*, not just per adapter id:

| Surface (adapter `claude-code`)        | `UserPromptSubmit` fires? | Effect on RAG injection                        |
|----------------------------------------|---------------------------|------------------------------------------------|
| Claude Code Desktop / CLI              | Yes                       | Seam runs; `paqad.rag-evidence` is recorded    |
| Claude Code in VS Code                 | Yes                       | Seam runs                                       |
| Claude agent in JetBrains (PhpStorm / IntelliJ) | No (as measured)  | Seam never runs; agent falls back to grep/read |

This is a host limitation, not a paqad wiring gap: paqad writes the hook into
`.claude/settings.json` (not a plugin), yet the JetBrains Claude surface did not
execute the `UserPromptSubmit` hook in the #313 cross-provider benchmark — no
`paqad.rag-evidence` session was written at all, while the same session's `Stop`
hook did fire. Upstream Claude Code has open bugs in the same family (hook
execution/output not honored consistently across IDE surfaces, e.g.
anthropics/claude-code #12151, #10225, #18547). paqad cannot force a host to run a
hook it does not run, so on that surface retrieval degrades cleanly to the
grep/read default rather than failing. The `Stop`-driven completion tier
(verification + stage evidence) is unaffected and still records there.

## 3. What Determines Whether a Prompt Becomes "Development"

Not every prompt produces code. The branch points are:

- **Stage 9 — intent classification.** A Paqad workflow phrase routes to a
  deterministic procedure. Free-form English routes to the generalist
  loop. Short exploratory questions ("how would we…") are answered in
  2–3 sentences with no edits per the response-style rules.
- **Stage 10 — capability gating.** A repo without the `coding`
  capability cannot end in code edits even if the user asks; it will be
  redirected to docs or refused.
- **Stage 13 — Decision Pause.** Architectural choices halt
  implementation until the user resolves a packet. This is the most
  common reason a prompt does **not** immediately produce a diff.
- **Stage 17 — compliance.** A change that violates the module-map or
  stack versions is rejected before egress in strict lanes.

## 4. Where Each Concern Lives in This Repo

| Concern                      | Module                                                                                                                     |
|------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| Routing                      | [`agent-routing`](agent-routing/index/summary.md)                                                                          |
| Runtime loop                 | [`agent-runtime`](agent-runtime/index/summary.md)                                                                          |
| Skill loading                | [`skill-runtime`](skill-runtime/index/summary.md)                                                                          |
| Workflow procedures          | [`workflow-engine`](workflow-engine/index/summary.md)                                                                      |
| Targeted retrieval           | [`context-intelligence`](context-intelligence/index/summary.md), [`hybrid-rag`](hybrid-rag/index/summary.md)               |
| Pause gate                   | [`decision-pause-contract`](decision-pause-contract/index/summary.md)                                                      |
| Rules / module-map authority | `docs/instructions/rules/module-map.yml`, [`rules-runtime`](rules-runtime/index/summary.md)                                |
| Stack pinning                | `docs/instructions/stack/overview.md`, [`stack-detection-engine`](stack-detection-engine/index/summary.md)                 |
| Validation                   | [`compliance-engine`](compliance-engine/index/summary.md), [`module-health-ledger`](module-health-ledger/index/summary.md) |
| Cross-adapter entry          | [`adapter-onboarding`](adapter-onboarding/index/summary.md), `CLAUDE.md`, `.paqad/framework-path.txt`                      |

## 5. Failure / Pause Modes (quick reference)

| Mode               | Stage  | Visible symptom                                               |
|--------------------|--------|---------------------------------------------------------------|
| Permission denied  | 15     | Tool call rejected; agent must adjust approach                |
| Hook blocked       | 15     | `<user-prompt-submit-hook>` message; agent must read & comply |
| Decision Pause     | 13     | Agent stops; `.paqad/decisions/pending/D-{id}.json` appears    |
| Stale module-map   | 17     | Compliance error; map must be updated **before** doc regen    |
| Cache miss         | 20     | Slower, more expensive turn; usually after >5 min idle        |
| Context compaction | 7 / 20 | Older turns summarized; some detail lost                      |

## 6. Reading Order for Newcomers

1. `CLAUDE.md` (this file's neighbor) — the entrypoint contract.
2. `.paqad/framework-path.txt` → `~/.paqad-ai/current/base/` — the runtime.
3. `docs/instructions/rules/module-map.yml` — the single source of truth.
4. `agent-routing`, `workflow-engine`, `decision-pause-contract` — the
   three modules that most shape what a prompt becomes.
