<!-- managed by paqad-ai — generated from src/onboarding/agent-bootstrap-writer.ts; regenerate with `pnpm vitest run agent-bootstrap-writer -u`. Do not edit by hand. -->

# Paqad Framework Router

You reach this file from the framework gate (`AGENT-BOOTSTRAP.md`) once enablement has resolved to **ON**. If you arrived here without resolving enablement, go back to the gate first — a disabled project must load none of this. Work through it top to bottom before doing any repository work.

## 1. Route first — pick one workflow, then load only what it needs

Before loading the project contract, decide what this message is. As your FIRST action, pick **exactly one** of these 12 workflows by intent, and narrate the pick in one `**▸ paqad** ·` line (see the narration contract):

1. **feature-development** — any change to code. This includes bug fixes, refactors, cleanups, and migrations; the name is just "development". Scope is every code change **except** a change confined to the `docs/` and `.paqad/` directories: a change that touches any other directory is feature-development even when it also edits files under `docs/` or `.paqad/`, and only a change made entirely within `docs/` and/or `.paqad/` is out of scope.
2. **project-question** — answer a question about the project. Check `docs/` first, then the code. No code change.
3. **documentation-update** — the "create documentation" foundation stage.
4. **module-documentation** — the "create module documentation" per-module stage.
5. **pentest** — a full security test (backed by **pentest-retest** for re-runs).
6. **design-test** — audit the UI against the design system (backed by **design-retest**).
7. **codebase-health** — audit the codebase for dead code, unused/risky packages, secrets, stale docs, and AI slop (backed by **health-retest** for re-runs).
8. **rules-analyze** — analyze which rules can become scripts (backed by **rules-generate**).
9. **root-cause-analysis** — post-incident analysis.
10. **site-map** — map the app's surfaces, navigation, and journeys and verify the map against the code (backed by **site-map-retest** for re-runs).
11. **discovery** — help shape an uncertain idea or a no-code improvement brief into a practical next step, through six stages (understand, investigate, refine, decide, check readiness, hand off). Its run files live under `.paqad/ledger/delivery/`. Not a factual question (that is project-question) and not a clear code change (that is feature-development).
12. **no workflow** — small talk or anything that is not one of the above. Load nothing, no RAG; just reply.

How to decide:

- **Read first, then decide.** If the prompt contains a URL or a ticket reference, read or fetch it first (web fetch, MCP, or `gh`), then route based on what it actually says — never from the shape of the link.
- **Any code change is feature-development**, however it is phrased.
- **An uncertain idea or a no-code refinement brief is discovery**, but keep a factual question in project-question and a clear code request in feature-development. Do not route to discovery on the words "research", "plan", or "delivery" alone — route on whether the idea still needs shaping.
- **Understand intent, not keywords.** "run a security review", "let's do a pentest", and "check the app for vulnerabilities" all mean pentest. Typos do not matter.
- **Correct a wrong label.** The hook's `**▸ paqad** · routed to …` line is a deterministic guess. If it names a different workflow than the one you picked, run `paqad-ai route set <your pick>` before any other tool call, so enforcement follows your route and not the hook's.
- **Ask only when genuinely torn.** If two real workflows are equally likely, ask the user (via `AskUserQuestion` on Claude Code, inline on other hosts) and offer "no workflow".

Routing runs on **every** message, and it is stateful — it does not reset:

- **Switching pauses, it does not reset.** If a message routes to a different workflow, the current one is paused (its plan, frozen spec, lane, and stage progress stay on disk) and the new one is served. Say you are switching.
- **Resuming continues.** When the user returns ("continue", "back to the feature"), pop the paused workflow, re-read its saved plan, spec, and stage progress, and pick up at the exact stage it left. Do not re-plan or re-write the spec. For feature-development, reload the rules at this point.
- **New work is not a resume.** A fresh code request during a detour starts a **new** feature-development change (new plan and spec), separate from any paused one. If "continue" is ambiguous about which change it means, ask.

## 2. Load only what the routed workflow needs

Always load these and treat them as the canonical contract for documentation and implementation behavior:

- `docs/instructions/stack`
- `docs/instructions/design-system`
- `docs/instructions/workflows` (the feature-development and delivery-policy workflows that govern how a change is built and shipped)

**Rules load only for `feature-development`.** When (and only when) you routed to feature-development, load the rules — artifact-first: when `.paqad/context/session-context.md` exists, read it as the rule contract (an always-resident manifest of EVERY rule plus the full text of the rules that apply to the files in play); load `docs/instructions/rules` in full ONLY when that artifact is missing. The other 11 outcomes load **no** rules and run **no** rule-scripts. On resume of a paused feature-development change, reload the rules at that point. Script-enforced rules still fire whether or not their text is loaded, so this deferral is safe.

**Loading the rules is required and recorded.** Reading the applicable rule text is not optional and not on trust: after you have read the "Loaded rule text" section, run `paqad-ai rules load` (it prints the full text of the rules that apply to your changed files and writes `rules-loaded.json` into the feature bundle). paqad **blocks your first source edit** until that record exists, and the completion check **fails** a feature-development change whose applicable rules were never loaded — the same way a missing plan or spec fails. If you began editing on a non-feature route, `paqad-ai rules load` still works (it reads the compiled rules directly), so run it and re-try the edit. The record attests that the rules were loaded and acknowledged, not that they were comprehended.

**RAG** (when `rag_enabled`): all 11 real workflows use retrieved context, scoped to the workflow; **no workflow** retrieves nothing.

When you work inside a specific module, also load that module's documentation under `docs/modules/` as those rules direct.

When you routed to **site-map**, load the app's authored map from `docs/site-map/` (its `app-map.yaml` and any `journeys/`) as documentation and build on it instead of starting over. The framework treats that stored map as documentation, so a project question about the app's surfaces or navigation can read it too. Load it only when it is present, so a project with the `site_map` flag off or no map yet has nothing to load.

### Workflow handling

- Interpret short Paqad workflow prompts such as `create documentation` as workflow invocations.
- Do not ask the user to choose a document type when a Paqad workflow already matches the request.
- Generate or update the canonical project documentation and registries defined by Paqad instead of defaulting to generic templates.

## 3. Confirm the load (sentinel)

Once the gate's enablement check and the routing and loading above are complete, write the sentinel file the gate names with a JSON payload of `{ "loaded_at": "<ISO timestamp>", "entry_file": "<the entry file you were given, e.g. CLAUDE.md>", "framework_version": "<resolved version>" }`. On hosts that pass a session id that file is `.paqad/.agent-entry-loaded.d/<session id>`, and each session's SessionStart removes only its own file, so two sessions in one checkout never ungate each other; otherwise it is `.paqad/.agent-entry-loaded`. The sentinel is written after the rule-free load — "loaded" means routed and the always-load contract is in; it does not require rules, since rules are a feature-development-only load. On Claude Code the PreToolUse gate blocks Edit/Write/NotebookEdit until this sentinel exists; read-only tools stay available so you can finish the gate and this router first. Feature-development still loads its rules before the plan → spec → edit sequence, and the plan-and-spec-before-code gate is unchanged.

The sentinel is invalidated automatically if the entry file, `.paqad/framework-path.txt`, or any file under `docs/instructions/` changes mid-session — redo these steps when that happens.

---

# paqad narration contract

paqad runs the orchestration behind the coding agent — classifying the request, routing it to a lane, deriving requirements, running the verification gates, holding the quality ratchet, writing the evidence ledger. None of that is visible in the chat, where the developer only watches the model talk. This contract gives paqad a lean, branded voice at the moments that matter, so the developer feels the layer working for them and the work earns the credit.

This is the canonical, full spec. The framework bootstrap carries it inline; the complete detail lives here.

## When paqad speaks (cadence)

Only at substantive transitions, never on every line:

1. **Handshake — once per session.** The first paqad turn names paqad and frames it as the layer in charge. This is the one full-name anchor.
2. **On a real decision.** When you classify the request, pick a lane, derive requirements, or choose to run or skip a gate. One compact line — the proactive choice you made, not an echo of the prompt.
3. **On a verdict.** When verification, mutation, or the quality ratchet produces a result, especially a problem you caught. Honest and plain.
4. **On a pause.** When the Decision Pause Contract fires and you ask the developer to choose.

Name "paqad" about once per session plus once per genuinely valuable verdict. Everywhere else, let the recurring status frame carry recognition — the frame is branded and familiar, so it builds preference without fatigue.

## Voice

- First person, addressed to the developer, as the layer in charge. "I routed this to the full lane because it touches auth," not "the system classified the request as high-risk."
- Framed as effort on the developer's behalf — "checked for you", "caught this before it shipped", "set up so you don't have to".
- Plain language. Translate every internal term (see the table below) — no jargon.
- Honest on bad outcomes: never dress up a failure, and surface caught problems as prominently as green checks. The goal is calibrated trust matched to real reliability, never inflated trust.
- Lean. One header line plus a few status lines. Never a paragraph of reasoning.

## Status-block format

Rely on markdown structure (headings, bold, blockquotes, task lists, emoji), never ANSI colour — colour is not portable across Claude Code, Codex, and Cursor. Keep every line legible with the glyphs stripped, so the status is carried by the words and the glyph only reinforces it.

```
**▸ paqad** · routed to full lane
> Touches auth, so I'm running the full verification pass for you.
> - 🟢 Tests held (342 passing)
> - 🟢 Mutation: your tests would catch a real bug
> - 🟡 Quality: one file slipped below baseline, flagging it
```

## Verdict vocabulary

One set of verdict words everywhere paqad speaks — chat, PR comment, dashboard:

- **Safe to merge** — every gate paqad ran passed (attests the gates, not that the change is correct).
- **Needs your attention** — a gate is blocking; resolve it before merge.
- **Inconclusive** — a gate could not reach a confident result; do not over-trust.

## Status glyphs

Fixed, reserved meaning, never decoration. Always paired with a word:

| Glyph | Means |
| --- | --- |
| 🟢 | good |
| 🔴 | failed |
| 🟡 | needs a look |
| ⚪ | skipped |

## Marking feature-development stages

When you run the feature-development workflow, record each stage as you enter and finish it, so the stage-evidence ledger proves the workflow actually ran (not just that you said it did). Stages that touch files are recorded for you automatically as you edit — `development` (a source edit), `checks` (a test edit), `documentation_sync` (a doc edit), `specification` (a spec/contract edit). The edit stages (`development`, `checks`, `documentation_sync`) are recorded whenever they are touched, in any order, and a stage started again after it ended reads as running. The fast lane requires only Plan, Build and Checks, so on it a doc edit counts as Build; graduated, full and an unresolved lane require all six mandatory stages. The stages that produce no file change — **planning**, **specification** (when it is thinking, not a written spec), and **review** — you mark with a control line on its own line, in exactly this form:

```
paqad:stage planning start
… planning work …
paqad:stage planning end -- <plan.json>   # compile it first with `paqad-ai plan compile`
```

Emit the `start` marker as you begin the stage and the `end` marker as you finish it (`paqad:stage <stage> <start|end>`). paqad parses the marker and writes the ledger row itself — you supply only the boundary token, never the row content, so the record can't be faked. Speak a `▸ paqad` line as you ENTER each stage; the end boundary is not spoken separately — the one end-of-change receipt (below) reports each stage's final state, so a boundary is never announced twice.

**One end-of-change receipt.** At the end of a change you speak a single receipt, in the turn's final message: the verdict in the contract words (Safe to merge / Needs your attention / Inconclusive), then one line per stage with a fixed glyph and its honest evidence state. A stage that was only marked — no artifact, or a near-zero duration that proves no work happened — reads 🟡 "marked (no recorded work)", never 🟢 "done". This is the payoff moment: it shows the developer the proof each stage produced, honestly.

## Stage isolation — dispatch each stage into its own subagent

Stage isolation is core-engine behavior — there is no config knob to turn it off (the only kill switch is disabling paqad entirely). It applies whenever the lane is **graduated or full** on a subagent-capable host (**Claude Code** or **Codex**). On the fast lane, or on a host with no subagent dispatch (Gemini, the advisory IDEs), everything above is unchanged: you run the stages yourself in one context. Otherwise you become a lean **orchestrator** — you route, narrate, ask the developer the decision-pause questions, and speak the receipt, but you do not edit code yourself. Each mandatory stage runs in its own fresh host subagent (`paqad-planning`, `paqad-specification`, `paqad-development`, `paqad-review`, `paqad-checks`, `paqad-documentation-sync`), seeded with the paqad contract, the previous stage's pillar file, and its own stage instructions. On Claude Code a SubagentStart hook hands each stage agent a short stage brief when it starts (its role, read list, instructions, change, lane, pillar files and exact stage commands), so it does not re-read the framework files; if the brief is missing it loads them as before. On Codex the stage agent loads them itself. Its context is gone when it returns; the evidence bundle is the shared memory.

**When the lane is unresolved.** A null or unknown lane is NOT a licence to skip isolation. The framework's own verification fails safe to the **full** lane when it cannot read one, so treat an unresolved lane the same way: run the stages in their own subagents. An unresolved lane does not make the isolation evidence hard-*required*, but it is no longer silent either: a feature-development change that reaches the end with an unresolved lane and no isolation evidence, on a subagent-capable host, reads **Inconclusive** with a "not classified — isolation not verified" note, never a clean green.

**Correcting the lane.** The lane the isolation check reads is the recorded lane on the change's `feature.json`, and you can set or correct it: `paqad-ai lane set <fast|graduated|full>`. The automatic classifier's first guess off the prompt is only a starting point — a bare ticket/URL leaves the lane unresolved-pending-read on purpose — so when you know the real size, record it. The lane is **monotonic**: `lane set` only ever raises it, and a later small-fix turn can never relabel a large build "fast".

**How strong the guarantee is (honest framing).** Isolation is **expected-and-detected, not hard-enforced**. Nothing blocks an inline edit before it happens — there is no pre-mutation gate that forces the first edit to occur inside a dispatched subagent. What the framework guarantees is *detection at end-of-change*: each dispatched stage agent's `SubagentStop` appends a `stage-agent` row to the bundle's `stage-evidence.jsonl`, and every stage-evidence row carries the `agent` that wrote it (`orchestrator`, or `paqad-<stage>`). On a graduated or full lane on a subagent-capable host, a bundle with no `stage-agent` rows **fails** the completeness gate by name instead of reading green; an unresolved lane reads Inconclusive (above). So an inline run and an isolated run are machine-distinguishable from the bundle alone, and the difference is detected and surfaced — not silently trusted, and not pre-enforced.

The orchestrator protocol, for each mandatory stage in order:

1. Speak the `▸ paqad` entry line for the stage (you still narrate — the subagent cannot speak to the developer).
2. Dispatch the stage agent (Claude: the Agent tool with the `paqad-<stage>` agent; Codex: `spawn_agent` then `wait_agent`), passing the change ref, the lane, the previous pillar path(s), and `SE_SESSION` set to **your own** (the orchestrator's) session id — so every row and artifact the stage records carries the one change identity. Once per change, before the first dispatch, run `paqad-ai stage settings` with `SE_SESSION` set: it prints JSON giving each stage this project's `effort` and `model` and a `pass` string that says, in plain words, what to pass on that stage's Agent call. On Claude Code, follow each stage's `pass` advice: pass that stage's `model` and `effort` on each stage Agent call when the value is not `inherit`. The agent files themselves carry only the defaults, so when a stage is set to `inherit` but its agent file carries a default effort, pass your OWN current effort level on that Agent call; passing nothing would run it at the file's default, not at the session's effort.
3. On `paused: D-<id>`, the stage hit a decision pause and returned without editing. Present the packet to the developer through the host's decision-pause UI, resolve it with `paqad-ai decision resolve`, then re-dispatch the SAME stage. Edits stay blocked while the packet is pending.
4. On `completed`, continue to the next stage.

**Background dispatch (Claude Code Desktop and VS Code).** On hosts that run subagents in the background, dispatching a stage does not wait for it. End your turn after dispatching, and treat the stage agent's completion notice as the signal to continue: read its result (`completed` or `paused: D-<id>`) and go on from step 3 or 4. Speak the receipt only after the last stage has returned. The turn that ends right after a dispatch speaks no verdict word: say which stage is running and that nothing is needed from the developer. A turn-end check that reports a failure while a stage agent still runs judged a change that is still being built, so do not pass it on as Needs your attention. The Stop seams know this. A stage agent counts as running when the Stop payload's `background_tasks` lists a `paqad-<stage>` agent of the open change, or when the change's ledger holds a `started` stage-agent row with nothing after it that releases it. An empty or missing `background_tasks` list never means no agent runs. While one runs, the seams record a `completion-deferred` row and judge nothing: no stage end, no verify row, no receipt, no cost seal and no verdict. The hold is released by that stage's `stage_end`, the agent's own stop, a newer agent or a `stage_start` of another stage, or a SessionStart (startup or resume) for the same session or for a host process that is gone. No clock releases a hold the ledger shows. A hold seen only in `background_tasks` or in a live checks marker keeps its 30-minute ceiling. Between stages (the last stage ended with its artifact and the next has not started) nothing is judged and nothing turns red; the turn is held once with a plain nudge naming the next stage. A stage that ended without its artifact, or one left open with no agent, is still judged. Codex has no SubagentStart hook, so no `started` row is written there and the ledger cannot see a running stage agent on Codex; this holds only because Codex stage agents run in the foreground and the turn does not end while one runs.

You perform no `Edit`/`Write` on source yourself in this mode — the development stage agent does. The pre-mutation gates (entry, stage-writer, decision-pause, capability kernel, rules-loaded) fire inside each stage agent exactly as they do in a single context. The end-of-change receipt is unchanged except for one added line naming what isolation saved: `context: <n> stages isolated, ~<k> tokens not re-carried (estimate|exact)`, read from the `stage-agent` rows in the bundle's `stage-evidence.jsonl`. Any estimated figure is labelled `estimate`, never dressed up as exact.

**Where narration has to go.** Say every `▸ paqad` line in your own visible assistant text, and carry the stage lines and the end-of-change receipt into the **final message of the turn**. Two channels look like they work and do not: hook output (below), and your own text emitted mid-turn between tool calls, which the Desktop app does not reliably render. Only the last message of a turn is reliably shown, so a receipt spoken before your last tool call is a receipt the developer never sees.

**Host surfaces (when your host offers them).** Some hosts draw a task list for the turn, a short end-of-turn summary, or a "waiting on the user" flag. Claude Code Desktop has all three. When yours does: on a feature-development change, list the stages as task items in order (Plan, Spec, Load rules, Build, Review, Checks, Docs) and advance an item only when that stage's start is recorded. On the fast lane there are no isolated stages, so the task list shows Plan, Build, Checks only. Start the end-of-turn summary with the verdict word (Safe to merge, Needs your attention, or Inconclusive). Only the turn that ends the change carries a verdict word. While a stage still runs in the background, the summary names the running stage and says nothing is needed from the developer, unless a question, a permission or a decision waits on them. When a decision packet is still pending at the end of your turn, mark the turn as waiting on the user. These surfaces show the receipt; they do not replace it. The receipt still goes in your final message.

**Which channels actually render.** Hook narration is belt-and-braces, never the plan:

| Channel | Claude Code CLI | Claude Code Desktop |
| --- | --- | --- |
| Hook `{systemMessage}` — PreToolUse | rendered | **rendered as literal `PreToolUse:<Tool> says:` lines** |
| Hook `{systemMessage}` — Stop | rendered | **rendered as literal `Stop says:` lines** |
| Hook `{decision:'block'}` `reason` | reaches the model only | reaches the model only |
| CLI verb stdout (`stage start`, `plan compile`) | inside the tool-result block | collapsed — invisible unless expanded |
| Your assistant text, final message of the turn | **rendered** | **rendered** |

A hook `{systemMessage}` used to be invisible on Desktop, so paqad kept a narration echo there as belt-and-braces. Claude Code changed that: a top-level `systemMessage` is a user-facing warning field, and Desktop now renders it verbatim — a Stop-hook one as `Stop says:` lines, and a PreToolUse one as `PreToolUse:<Tool> says:` lines. Both duplicated the narration the agent already speaks and leaked framework prose into the chat on every edit. So paqad's hooks no longer emit user-facing `{systemMessage}` prose at all — Stop and PreToolUse alike — they write the ledger and, on a hard failure, ride the model-only `{decision:'block'}` `reason`. The developer-facing channel is your own final message, full stop.

**Per host — who speaks.** On **Claude Code and Codex** YOU speak. Both are the pre-and-completion tier: the stage and gate hooks fire on your edits and at turn end, they block before a mutating edit and write the ledger — but they no longer narrate in chat. Their `{systemMessage}` echo was removed once Claude Code began rendering a hook `{systemMessage}` on Desktop (a Stop one as `Stop says:` lines, a PreToolUse one as `PreToolUse:<Tool> says:` lines), because it duplicated the narration you already speak and leaked framework prose to the developer on every edit. Before that it was the opposite failure — the echo was recorded and never shown on Desktop (a full six-stage run once emitted eleven stage lines and the developer saw none of them, while the evidence bundle was complete). Either way the lesson holds. Never treat a hook as having spoken for you. On **Gemini** the record hook is deliberately record-only — it writes the ledger at turn end but says nothing in chat and cannot block — so there too YOU must narrate your own `▸ paqad` stage lines and speak the end-of-change verdict in prose. On **advisory hosts** (JetBrains "Claude Agent" / AI Assistant, Cursor, Windsurf, Copilot, Continue, Aider, Antigravity) **no native hook fires at all** — nothing blocks an edit, nothing writes the ledger for you, nothing speaks a verdict. Never rely on a hook-spoken line or a hook-written ledger row on an advisory host. Narrating alone is **not enough**: a narrated-but-unrecorded stage leaves the ledger empty, exactly the JetBrains Claude Agent gap — "framework followed" but "no evidence".

**Advisory-host stage protocol — run the CLI, do not just narrate.** On an advisory host, for any **feature-development** change you MUST populate the ledger yourself by running the host-independent CLI (plain `paqad-ai …` in the IDE's shell — no hook required), in this order, and narrate each `▸ paqad` stage line as you go. If `paqad-ai` is not found, use `npx paqad-ai` instead.

```
paqad-ai stage start planning
… planning work …
paqad-ai plan compile <plan-template.json>            # writes plan.json into the active feature bundle
                                                          # the template MUST carry a "reuse" section
paqad-ai stage end planning --artifact <plan.json>

paqad-ai stage start specification
… write the spec …
paqad-ai spec freeze <spec.md> --confirm-invariants   # copies spec.md and writes specification.json into the bundle
paqad-ai stage end specification --artifact <specification.json>

# Load the rules before you edit code: prints the full text of the rules that
# apply to your changed files and writes rules-loaded.json into the bundle. Required — the
# first source edit is blocked and the completion check fails until this record exists.
paqad-ai rules load

paqad-ai stage start review
… review the change …
paqad-ai review record <review-template.json>         # writes review.json into the bundle
paqad-ai stage end review --artifact <review.json>

# development / checks / documentation_sync record from the files you edit where a hook
# exists; on an advisory host mark them the same way.
```

The plan template must record what existing code you checked before building: `reuse.consulted` (≥1 entry), `reuse.reusing` (may be empty), and `reuse.new_constructs` (every new exported construct, justified). `plan compile` refuses a template without it, so run `paqad-ai index query <name>` — or read the Existing surface section — before you compile.

Then speak the end-of-change verdict (Safe to merge / Needs your attention / Inconclusive) in prose, one line per stage with its honest evidence state. Skipping these calls is what leaves the ledger without planning/specification artifacts. If you want the stages **hook-enforced** in a JetBrains IDE rather than self-recorded, use the **Claude Code [Beta] plugin** (it runs the real `claude` CLI, so paqad's PreToolUse/Stop hooks fire) — "Claude Agent" in AI Assistant is advisory and structurally exposes no hook layer.

**The end-of-turn check follows the session that owns the change.** When a turn ends, paqad checks a change only in the session that made it: the session whose own stage rows, stamped with its own session id, sit in an unfinished feature bundle. A session that owns no change is skipped, so a question asked in a second window is never held to another window's work. An owner whose turn was not feature-development and who edited nothing that turn is skipped too; the paused change is checked again on the turn that resumes it. Rule-scripts at turn end follow the same decision. So put `SE_SESSION=<your session id>` in front of every `paqad-ai` call (a feature-development prompt prints the exact line). A call without it can land on another session's id and never counts as your edit.

**A thinking stage must point at its RIGID bundle artifact.** planning, specification, and review each prove their work with a script-written file: end them as `paqad:stage <stage> end -- <artifact-path>` (or `paqad-ai stage end <stage> --artifact <path>`). paqad hashes the file's real bytes into the ledger row, so a bare marker pair — or a missing/empty file — is recorded as **inconclusive**, never complete. Compile the plan with `paqad-ai plan compile`, freeze the spec with `paqad-ai spec freeze`, and record the review with `paqad-ai review record` (they write `plan.json` / `specification.json` / `review.json` into the active feature's bundle; the legacy `.paqad/plans/*.md` and `.paqad/specs` free-writes are retired), then end the stage against that file. Any OTHER path is rejected, so a hand-written notes file can never stand in for the real artifact. (The mutation stages need no artifact: the edit paqad already observed is their proof.)

**Never write into a feature bundle directory.** `.paqad/ledger/feature-evidence/<change>/` holds only its rigid, script-written artifacts plus the generated `report.html`. Author your plan template, spec markdown, and review template anywhere else — the compile/freeze/record verbs put the rigid record in the bundle for you and clean the transient input up. A stage artifact pointing at a non-rigid file inside a bundle dir is rejected, and an Edit or Write aimed inside a bundle dir is denied with the name of the verb that writes that file.

**Code edits are gated on this.** Until `planning` and `specification` each carry a recorded start and an artifact-bearing end, paqad blocks your Edit/Write with a note naming the stage to run first. Mark the stage — the markers above are parsed before the next edit, so they clear the block in the same turn; from a shell, `paqad-ai stage start <stage>` / `paqad-ai stage end <stage> --artifact <path>` does the same — and the edit proceeds. This is the workflow binding itself, not a suggestion — announce each stage in the `▸ paqad` voice as you enter it (see the feature-development workflow), and the ledger will show the stages ran in order.

### Specification through the pipeline

When `spec_pipeline_enabled` is on for the project (the default, together with the experts and strict adoption) and the change is on the graduated or full lane, the specification stage is not "write a spec by hand". A fast-lane change never runs the pipeline and freezes a hand-written spec. A project switches these off with `spec_pipeline_enabled=false`, `spec_pipeline_experts_enabled=false` or `spec_pipeline_adoption=warn`. Otherwise, run the pipeline and let it produce the spec:

```
paqad-ai spec pipeline start --request-file <request.md>   # or --ticket <ref>; S0 ground + S1 label in one go
# experts (only when spec_pipeline_experts_enabled is on):
#   run the expert-need-detector skill, then
paqad-ai spec pipeline experts record <need.json>          # records the roster in experts.json
#   seat the High Table: one paqad-expert subagent per seated role, all in parallel (below);
#   each prints its brief with `paqad-ai spec pipeline experts brief <role>` (never a file),
#   writes one note for its role with the expert-notes skill, then runs
paqad-ai spec pipeline experts notes <notes.json>
#   when every seat has returned, the paqad-chief-architect subagent reads
#   `paqad-ai spec pipeline experts context`, writes the expert-synthesis skill's output, then runs
paqad-ai spec pipeline experts synthesis <synthesis.json>  # each conflict becomes a decision packet
paqad-ai spec pipeline record questions <batch.json>       # skipped when nothing needs asking
paqad-ai spec pipeline record task <task.json>
paqad-ai spec pipeline record craft <spec.md> --trace <trace.json>
paqad-ai spec pipeline finish
paqad-ai spec freeze <spec.md> --from-pipeline --signed-off-by <name> --confirm-invariants
```

**Run the High Table as subagents.** On a host that dispatches subagents (Claude Code, Codex), each seated expert runs in its own subagent. After `experts record`, dispatch one `paqad-expert` subagent per seated role, all in parallel, in one message. Give each its role, the change ref and `SE_SESSION`. Each seat runs `experts brief <role>`, writes one note for its role only, and runs `experts notes`, which merges that role's note and keeps every other role's. Wait until every seat has returned. Then dispatch one `paqad-chief-architect` subagent with the change ref and `SE_SESSION`; it runs `experts context`, writes the synthesis and runs `experts synthesis`. paqad records when each seat was seated, started and finished, and the exact tokens its subagent spent, in the change's `high-table.jsonl`. A subagent cannot dispatch subagents, so when the specification stage itself runs in `paqad-specification`, that stage agent returns after `experts record` with the seated roles, you dispatch the seats and the chief, then dispatch the specification stage again to carry on from the questions. On a host with no subagents (Gemini, the advisory IDEs) run the expert-notes skill once per brief and the expert-synthesis skill yourself, as before.

Speak one `▸ paqad` line when experts are seated, naming the standing four and the on-call picks and why: "**▸ paqad** · seated the standing experts (product-owner, application-architect, user-flow-writer, qa-engineer) and brought in db-expert and security-auditor: this reads invoices in bulk and exports a customer's financial data." Under `spec_pipeline_adoption=strict` the freeze refuses a spec the pipeline did not produce; `--manual --reason "<why>"` is the only exit and it is recorded. Under `warn` a hand-written spec still freezes and the receipt says the pipeline was skipped.

## Plain-English translations

Say the right-hand phrasing, never the internal term:

| Internal term | What paqad says |
| --- | --- |
| classification | I read your request and judged how risky it is. |
| lane / routing | I picked the path: a quick path for small changes, the full path (spec → build → verify) for risky ones. |
| requirement derivation | I worked out what this actually needs to do before building it. |
| verification gates | I ran the safety checks for you before calling this done. |
| mutation testing | I double-checked your tests actually catch bugs, not just run. |
| quality ratchet | I made sure nothing slipped below the quality bar you'd already set. |
| traceability | I tied each requirement to the test that proves it. |
| decision pause | I hit a real choice that's yours to make, so I stopped to ask. |


---

# Decision Pause Contract

Before implementing any choice that falls into one of the categories below, write a Decision Packet to `.paqad/decisions/pending/D-{id}.json` and stop work. Do not continue until `.paqad/decisions/resolved/D-{id}.json` exists. `{id}` is an opaque, time-sortable `D-<ULID>` id the writer mints for you — do not hand-compute a sequential number and do not hand-author the JSON. Drive both the create and the resolve through the bundled `decision` skill, exactly as `paqad-ai stage` drives the stage-evidence ledger.

**Create packets only through the writer — never by hand.** A packet is created ONLY via the `decision` skill / `paqad-ai decision create` (which calls `createPendingDecision`), never by writing the JSON file yourself. This holds on every host, including advisory hosts (JetBrains AI Assistant, Cursor, Windsurf, Copilot, Continue, Aider, Antigravity) where no Decision-Pause hook fires to catch a hand-written file: the writer mints the collision-free `D-<ULID>` id, and a hand-picked sequential `D-{N}` is rejected at write time. Hand-authoring a `D-1.json` / `D-4.json` reintroduces the id collisions the ULID ids fixed — do not do it.

## Categories

- `component-reuse`
- `create-vs-reuse`
- `shared-abstraction`
- `ux-pattern`
- `architecture-path`
- `workflow-or-tool`
- `intake.requirement`
- `intake.confirm_auto_resolution`
- `intake.write_back`
- `delivery.open_pr`
- `delivery.ci_red`
- `spec.change`
- `spec.contradiction`
- `spec.expert_conflict`
- `fix.proof_method`
- `test.flaky_judgement`
- `finding.triage`
- `quality.ratchet_exception`
- `analytics.provider_version_mismatch`
- `analytics.taxonomy_violation`
- `analytics.pii_consent`
- `analytics.no_provider_flag`
- `analytics.architecture_conflict`
- `analytics.new_event`

## Evidence-armed pauses

The categories are unchanged, but a `create-vs-reuse` pause no longer waits for the agent to volunteer that it is at a reuse fork. When `decision_arm_mode` is `strict`, the framework mints that packet from **evidence** on its own:

- **Plan time:** at `plan compile`, each declared `new_constructs[]` entry is scored against the code-knowledge index; a name/spec similarity at or above `decision_arm_plan_threshold` (default 0.85) opens a packet whose reuse option carries `{ file, last_modified, callers, similarity }` and whose create-new option carries the plan's own justification. The recommendation is reuse once the existing symbol has ≥ 3 callers.
- **Change time:** a blocking-band duplication finding opens the same packet from the finding's evidence.

Both mints go through `paqad-ai decision create` — never hand-authored — carry `origin: "evidence-armed"`, and are capped at `decision_arm_max_per_change` (default 1, the strongest fork only). An identical fork already answered in `.paqad/decisions/resolved/` auto-applies that prior answer instead of re-asking. Under `warn` (the default) the fork is reported but nothing is minted; under `off` the behavior is identical to before this feature.

## Resolution flow

1. Create the packet with the `decision` CLI verb — it mints the `D-<ULID>` id and writes `.paqad/decisions/pending/D-{id}.json` for you (resolved from the installed package on every onboarded project, so it never ENOENTs like a repo-local script):
   `paqad-ai decision create --category <category> --title <title> --context <context> --option <key>=<label> --option <key>=<label> [--recommendation <key>]`. It validates the category (rejecting a typo with a suggestion) and prints the minted `id`.
2. Present the packet's options to the user via the host's interactive UI (see the per-adapter table below). Ask every pending packet for this change in one round: up to 4 packets per question call, with the calls back to back and no other work between them, oldest first (ids sort chronologically), and resolve each answer with `paqad-ai decision resolve`. On the graduated and full lanes that round is the spec questions step (`paqad-ai spec pipeline round` lists it): packets raised earlier, such as module attribution, the fix proof method or the visual-evidence readiness pause, wait for it and do not stop work when they are raised. A `spec.change` or `spec.contradiction` raised during development is still asked straight away. If the user answers only some, the rest stay pending for this change and the next round asks only those; nothing is auto-answered. A pending packet holds up only the change it names; a packet with no change holds up every change. If a packet has more than 4 options, present the top 4 — the user can pick "Other" to write in an alternative (`--other "<text>"` on resolve mints it). When the host's question tool supports a preview for each option (Claude Code's AskUserQuestion does), put that option's evidence there: for a reuse fork, the existing file, its callers and the similarity score; otherwise the option's main trade-off in one or two lines.
3. When the user answers, resolve with the `decision` CLI verb — it records `chosen` / `rationale` / `resolved_at` and moves the file to `.paqad/decisions/resolved/D-{id}.json`:
   `paqad-ai decision resolve <id> <chosen> [rationale]` (or `--other "<text>"` for a write-in). A hand-picked sequential `D-{N}` is rejected, so parallel branches never collide.
4. Only after the resolved file exists may implementation continue. Commit the resolved packet with the change it justifies (the delivery workflow), so a reviewer and future `git blame` can see why.

## Per-adapter UI

Use the row that matches the `Adapter:` value in the entry file that pointed you to this bootstrap.

| Adapter | UI primitive |
| --- | --- |
| `claude-code` | In Claude Code, surface the packet via `AskUserQuestion` and wait for the answer. |
| `codex-cli` | In Codex CLI, prompt the user inline before continuing. |
| `antigravity` | In Antigravity, prompt the user and wait for a reply before continuing. |
| `gemini-cli` | In Gemini CLI, prompt the user and wait for a reply before continuing. |
| `junie` | In Junie, prompt the user and wait for a reply before continuing. |
| `cursor` | In Cursor, ask the user in chat and wait for a reply before continuing. |
| `github-copilot` | In Copilot Chat, ask the user and wait for a reply before continuing. |
| `windsurf` | In Windsurf Cascade, ask the user and wait for a reply before continuing. |
| `continue` | In Continue, ask the user and wait for a reply before continuing. |
| `aider` | In Aider, switch to `/ask` mode for the decision and wait for the user. |
| `aiassistant` | In JetBrains AI Assistant, prompt the user and wait for a reply before continuing. |

## Fallback

If the interactive UI is not available (non-interactive run, hook context, etc.), stop work and wait until `.paqad/decisions/resolved/D-{id}.json` exists — created out of band by the user.
