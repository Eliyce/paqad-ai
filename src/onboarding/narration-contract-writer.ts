import {
  PAQAD_STATUS_GLYPH,
  PAQAD_STATUS_LABEL,
  PAQAD_TERM_TRANSLATIONS,
  PAQAD_VERDICT,
  paqadFrameLead,
  type PaqadStatusKind,
} from '@/core/constants/paqad-voice.js';

import { MANAGED_HEADER } from './decision-pause-contract-writer.js';

export const HOST_SURFACES_PARAGRAPH = `**Host surfaces (when your host offers them).** Some hosts draw a task list for the turn, a short end-of-turn summary, or a "waiting on the user" flag. Claude Code Desktop has all three. When yours does: on a feature-development change, list the stages as task items in order (Plan, Spec, Load rules, Build, Review, Checks, Docs) and advance an item only when that stage's start is recorded. On the fast lane there are no isolated stages, so the task list shows Plan, Build, Checks only. Start the end-of-turn summary with the verdict word (Safe to merge, Needs your attention, or Inconclusive). Only the turn that ends the change carries a verdict word. While a stage still runs in the background, the summary names the running stage and says nothing is needed from the developer, unless a question, a permission or a decision waits on them. When a decision packet is still pending at the end of your turn, mark the turn as waiting on the user. These surfaces show the receipt; they do not replace it. The receipt still goes in your final message.`;

export const RESUME_HANDOVER_TOKENS = 150000;

export const PLANNING_TO_SPECIFICATION_RESUME =
  'Planning is done. Continue as the specification stage for the same change. Run `paqad-ai stage brief specification` and follow it.';

export const HIGH_TABLE_RULED_RESUME =
  'The High Table has ruled. Continue the specification stage from the questions step.';

export const RESUME_PROTOCOL_PARAGRAPH = `**The resume protocol.** On Claude Code resume a stage agent with \`SendMessage\` and its agent id; on Codex use \`send_input\`. A resumed agent keeps its whole conversation, so it does not re-read what it already read, and it gets no new stage brief: when it moves to another stage, the resume message tells it to run \`paqad-ai stage brief <stage>\`. Dispatch a fresh agent instead only when the host cannot resume, refuses the resume or reports the agent gone, or when that agent's latest completion row (its newest \`stage-agent\` row with \`event_status: completed\` for that \`agent_id\`, never a sum of its rows) shows \`tokens_not_recarried\` above ${RESUME_HANDOVER_TOKENS}. A fresh dispatch hands over in its prompt the files changed so far, the decisions made and what is left. Hosts with no resume (Cursor, Gemini CLI, Copilot, Windsurf, Junie and the rest) keep the fresh-dispatch flow: every stage in a new agent, and a stage that paused dispatched again after \`paqad-ai decision resolve\`.`;

export const PLANNING_TO_SPECIFICATION_PARAGRAPH = `**Planning and specification in one agent (full lane).** When \`paqad-planning\` returns \`completed\`, do not dispatch \`paqad-specification\`. Resume the same agent with: "${PLANNING_TO_SPECIFICATION_RESUME}" When it returns after \`experts record\`, dispatch the expert seats and the chief in parallel as below, then resume the same agent again with: "${HIGH_TABLE_RULED_RESUME}" Follow the resume protocol below; its fresh-dispatch exit applies here the same way.`;

export const ONE_DEVELOPMENT_AGENT_PARAGRAPH = `**One development agent per change.** Development runs as ONE \`paqad-development\` agent per change. Dispatch it once with the whole plan. For anything development does after that (the next plan step, a fix after a paused decision, review fixes, acceptance-criteria test mapping, a fix after red checks), resume that same agent, naming what to do next. Follow the resume protocol below; its fresh-dispatch exit applies here the same way.`;

export const PARALLEL_REVIEW_AND_DOCS_PARAGRAPH = `**Review and documentation sync side by side, then checks once.** When \`paqad-development\` returns \`completed\`, dispatch \`paqad-review\` and \`paqad-documentation-sync\` together: on Claude Code, two Agent calls in one message; on Codex, two \`spawn_agent\` calls, then \`wait_agent\` on both. Go on only when both have returned, never on the first one back. If one of them fails, is blocked or pauses on a decision while the other completes, keep the completed stage and do not re-run it: ask the paused stage's packet as usual (both packets in one round when both pause), then resume or retry that stage. When review returns a finding that needs a code fix, apply it only after both have returned, by resuming the one development agent, and ask it to say in its return whether the fix changes what the docs describe (a documented behaviour, command, option, config key, file or name). Take its answer as it is and do not re-read the diff: dispatch \`paqad-documentation-sync\` again only when the fix changes what the docs describe, otherwise go straight to checks. Then dispatch \`paqad-checks\` once, on the final tree: only after review and documentation sync have both returned completed and any review fix (and any docs re-run) has landed. Checks runs a second time only when checks itself went red. On the fast lane, on a host without parallel subagents, and on a host with no subagent dispatch, keep the one-after-another sequence: review, then documentation sync, then checks. After the checks stage is green, do not run the project's full test command again on the same files; \`paqad-ai checks run\` reuses the green run.`;

export function buildNarrationContractBody(): string {
  const glyphRows = (Object.keys(PAQAD_STATUS_GLYPH) as PaqadStatusKind[])
    .map((kind) => `| ${PAQAD_STATUS_GLYPH[kind]} | ${PAQAD_STATUS_LABEL[kind]} |`)
    .join('\n');

  const translationRows = PAQAD_TERM_TRANSLATIONS.map((t) => `| ${t.term} | ${t.plain} |`).join(
    '\n',
  );

  return `# paqad narration contract

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

\`\`\`
${paqadFrameLead('routed to full lane')}
> Touches auth, so I'm running the full verification pass for you.
> - ${PAQAD_STATUS_GLYPH.good} Tests held (342 passing)
> - ${PAQAD_STATUS_GLYPH.good} Mutation: your tests would catch a real bug
> - ${PAQAD_STATUS_GLYPH.needsLook} Quality: one file slipped below baseline, flagging it
\`\`\`

## Verdict vocabulary

One set of verdict words everywhere paqad speaks — chat, PR comment, dashboard:

- **${PAQAD_VERDICT.pass}** — every gate paqad ran passed (attests the gates, not that the change is correct).
- **${PAQAD_VERDICT.fail}** — a gate is blocking; resolve it before merge.
- **${PAQAD_VERDICT.inconclusive}** — a gate could not reach a confident result; do not over-trust.

## Status glyphs

Fixed, reserved meaning, never decoration. Always paired with a word:

| Glyph | Means |
| --- | --- |
${glyphRows}

## Marking feature-development stages

When you run the feature-development workflow, record each stage as you enter and finish it, so the stage-evidence ledger proves the workflow actually ran (not just that you said it did). Stages that touch files are recorded for you automatically as you edit — \`development\` (a source edit), \`checks\` (a test edit), \`documentation_sync\` (a doc edit), \`specification\` (a spec/contract edit). The edit stages (\`development\`, \`checks\`, \`documentation_sync\`) are recorded whenever they are touched, in any order, and a stage started again after it ended reads as running. The fast lane requires only Plan, Build and Checks, so on it a doc edit counts as Build; graduated, full and an unresolved lane require all six mandatory stages. The stages that produce no file change — **planning**, **specification** (when it is thinking, not a written spec), and **review** — you mark with a control line on its own line, in exactly this form:

\`\`\`
paqad:stage planning start
… planning work …
paqad:stage planning end -- <plan.json>   # compile it first with \`paqad-ai plan compile\`
\`\`\`

Emit the \`start\` marker as you begin the stage and the \`end\` marker as you finish it (\`paqad:stage <stage> <start|end>\`). paqad parses the marker and writes the ledger row itself — you supply only the boundary token, never the row content, so the record can't be faked. Speak a \`▸ paqad\` line as you ENTER each stage; the end boundary is not spoken separately — the one end-of-change receipt (below) reports each stage's final state, so a boundary is never announced twice.

**One end-of-change receipt.** At the end of a change you speak a single receipt, in the turn's final message: the verdict in the contract words (${PAQAD_VERDICT.pass} / ${PAQAD_VERDICT.fail} / ${PAQAD_VERDICT.inconclusive}), then one line per stage with a fixed glyph and its honest evidence state. A stage that was only marked — no artifact, or a near-zero duration that proves no work happened — reads ${PAQAD_STATUS_GLYPH.needsLook} "marked (no recorded work)", never ${PAQAD_STATUS_GLYPH.good} "done". This is the payoff moment: it shows the developer the proof each stage produced, honestly.

## Stage isolation — dispatch each stage into its own subagent

Stage isolation applies on the lanes in \`stage_isolation_lanes\` (default: full) on a subagent-capable host. On other lanes, run every stage yourself in one context and mark each with \`paqad-ai stage start/end\`, exactly as on the fast lane. The subagent-capable hosts are **Claude Code** and **Codex**; on a host with no subagent dispatch (Gemini, the advisory IDEs) you also run the stages yourself in one context. Otherwise you become a lean **orchestrator** — you route, narrate, ask the developer the decision-pause questions, and speak the receipt, but you do not edit code yourself. Each mandatory stage runs in a host subagent (\`paqad-planning\`, \`paqad-specification\`, \`paqad-development\`, \`paqad-review\`, \`paqad-checks\`, \`paqad-documentation-sync\`), seeded with the paqad contract, the previous stage's pillar file, and its own stage instructions. On Claude Code a SubagentStart hook hands each stage agent a short stage brief when it starts (its role, read list, instructions, change, lane, pillar files and exact stage commands), so it does not re-read the framework files; if the brief is missing it loads them as before. On Codex the stage agent loads them itself. On a host that can resume a subagent, one agent carries planning into specification, one development agent serves the whole change, and each keeps its memory between resumes (the resume protocol below); otherwise a stage agent's context is gone when it returns. The evidence bundle is the shared memory either way.

**When the lane is unresolved.** A null or unknown lane is NOT a licence to skip isolation. The framework's own verification fails safe to the **full** lane when it cannot read one, so treat an unresolved lane the same way: run the stages in their own subagents. An unresolved lane does not make the isolation evidence hard-*required*, but it is no longer silent either: a feature-development change that reaches the end with an unresolved lane and no isolation evidence, on a subagent-capable host, reads **Inconclusive** with a "not classified — isolation not verified" note, never a clean green.

**Correcting the lane.** The lane the isolation check reads is the recorded lane on the change's \`feature.json\`, and you can set or correct it: \`paqad-ai lane set <fast|graduated|full>\`. The automatic classifier's first guess off the prompt is only a starting point — a bare ticket/URL leaves the lane unresolved-pending-read on purpose — so when you know the real size, record it. The lane is **monotonic**: \`lane set\` only ever raises it, and a later small-fix turn can never relabel a large build "fast". The one exception is \`plan compile\`: when the classifier guessed full and the plan is small and safe (8 files or fewer, none sensitive, no schema or breaking API change), it lowers the lane to graduated once, before any spec or code, and prints one line saying so. If the change then grows past that (more than 8 edited files, or a sensitive path), the next \`stage start\` or \`plan compile\` raises it back to full once and prints one line; from then on, starting with the stage whose \`stage start\` printed that line, dispatch each stage to its own stage helper, as on any full lane. Stages that ran inline before the raise stay accepted.

**How strong the guarantee is (honest framing).** Isolation is **expected-and-detected, not hard-enforced**. Nothing blocks an inline edit before it happens — there is no pre-mutation gate that forces the first edit to occur inside a dispatched subagent. What the framework guarantees is *detection at end-of-change*: each dispatched stage agent's \`SubagentStop\` appends a \`stage-agent\` row to the bundle's \`stage-evidence.jsonl\`, and every stage-evidence row carries the \`agent\` that wrote it (\`orchestrator\`, or \`paqad-<stage>\`). On a lane in \`stage_isolation_lanes\` on a subagent-capable host, a bundle with no \`stage-agent\` rows **fails** the completeness gate by name instead of reading green; an unresolved lane reads Inconclusive (above). Each \`stage-agent\` row also records how the agent returned: \`report_status\` (\`DONE\`, \`DONE_WITH_CONCERNS\`, \`NEEDS_CONTEXT\` or \`BLOCKED\`; the last status line in its reply, \`BLOCKED\` when it gave none), \`report_stated\` (whether it gave a status line at all), \`advance\` (true only for \`DONE\` or \`DONE_WITH_CONCERNS\` with no must-not breach) and, when it broke one, \`must_not\` listing which (\`asked_human\`, \`bundle_write\`, \`out_of_stage_edit\`). The must-not rules are read from the agent's own tool calls when it stops, so a breach is recorded and the stage does not advance, but the edit itself was not blocked. On Claude Code, when neither the paqad plugin agents nor a copy in \`~/.claude/agents/\` is present, the SessionStart hook shows \`stage agents are missing\` with Needs your attention and tells the Developer to install the plugin (\`/plugin install paqad@eliyce\`) and start a new session; stop there and never run the stage in the main session instead. So an inline run and an isolated run are machine-distinguishable from the bundle alone, and the difference is detected and surfaced — not silently trusted, and not pre-enforced.

The orchestrator protocol, for each mandatory stage in order:

1. Speak the \`▸ paqad\` entry line for the stage (you still narrate — the subagent cannot speak to the developer).
2. Dispatch the stage agent (Claude: the Agent tool with the \`paqad-<stage>\` agent; Codex: \`spawn_agent\` then \`wait_agent\`), passing the change ref, the lane, the previous pillar path(s), and \`SE_SESSION\` set to **your own** (the orchestrator's) session id — so every row and artifact the stage records carries the one change identity. Once per change, before the first dispatch, run \`paqad-ai stage settings\` with \`SE_SESSION\` set: it prints JSON giving each stage this project's \`effort\` and \`model\` and a \`pass\` string that says, in plain words, what to pass on that stage's Agent call. On Claude Code, follow each stage's \`pass\` advice: pass that stage's \`model\` and \`effort\` on each stage Agent call when the value is not \`inherit\`. The agent files themselves carry only the defaults, so when a stage is set to \`inherit\` but its agent file carries a default effort, pass your OWN current effort level on that Agent call; passing nothing would run it at the file's default, not at the session's effort.
3. On \`paused: D-<id>\` (its \`Status: BLOCKED\` line names the packet), the stage hit a decision pause and returned without editing. Present the packet to the developer through the host's decision-pause UI, resolve it with \`paqad-ai decision resolve\`, then resume the paused agent with the answer (the resume protocol below). Edits stay blocked while the packet is pending.
4. On \`completed\` (\`Status: DONE\` or \`Status: DONE_WITH_CONCERNS\`), continue to the next stage. After development, review and documentation sync run side by side and checks runs once after both (see "Review and documentation sync side by side" below).
5. On \`Status: NEEDS_CONTEXT\`, on \`Status: BLOCKED\` with no packet, or on a return with no Status line (for example a stage that ran out of turns), stop: do not advance to the next stage. Resume a NEEDS_CONTEXT stage with what it names; tell the developer what blocked the other two.

${PLANNING_TO_SPECIFICATION_PARAGRAPH}

${ONE_DEVELOPMENT_AGENT_PARAGRAPH}

${PARALLEL_REVIEW_AND_DOCS_PARAGRAPH}

${RESUME_PROTOCOL_PARAGRAPH}

**Background dispatch (Claude Code Desktop and VS Code).** On hosts that run subagents in the background, dispatching a stage does not wait for it. End your turn after dispatching, and treat the stage agent's completion notice as the signal to continue: read its result (\`completed\` or \`paused: D-<id>\`) and go on from step 3 or 4. Speak the receipt only after the last stage has returned. The turn that ends right after a dispatch speaks no verdict word: say which stage is running and that nothing is needed from the developer. A turn-end check that reports a failure while a stage agent still runs judged a change that is still being built, so do not pass it on as Needs your attention. The Stop seams know this. A stage agent counts as running when the Stop payload's \`background_tasks\` lists a \`paqad-<stage>\` agent of the open change, or when the change's ledger holds a \`started\` stage-agent row with nothing after it that releases it. An empty or missing \`background_tasks\` list never means no agent runs. While one runs, the seams record a \`completion-deferred\` row and judge nothing: no stage end, no verify row, no receipt, no cost seal and no verdict. The hold is released by that stage's \`stage_end\`, the agent's own stop, a newer agent, a \`stage_start\` of another stage that is not written by a different paqad stage agent and carries no \`agent_id\`, or a SessionStart (startup or resume) for the same session or for a host process that is gone. A \`stage_start\` written by a different paqad stage agent does not release a running agent's hold, and neither does one carrying an \`agent_id\`: a resumed agent stamps its own through \`SE_AGENT_ID\`, so starting its next stage keeps its hold, and when documentation sync starts while review runs, review's hold stays until review's own \`stage_end\` or stop. With the two side by side, end the turn after both dispatches and go on only once both completion notices have arrived. No clock releases a hold the ledger shows. A hold seen only in \`background_tasks\` or in a live checks marker keeps its 30-minute ceiling. Between stages (the last stage ended with its artifact and the next has not started) nothing is judged and nothing turns red; the turn is held once with a plain nudge naming the next stage. A stage that ended without its artifact, or one left open with no agent, is still judged. Codex has no SubagentStart hook, so no \`started\` row is written there and the ledger cannot see a running stage agent on Codex; this holds only because Codex stage agents run in the foreground and the turn does not end while one runs.

You perform no \`Edit\`/\`Write\` on source yourself in this mode — the development stage agent does. The pre-mutation gates (entry, stage-writer, decision-pause, capability kernel, rules-loaded) fire inside each stage agent exactly as they do in a single context. The end-of-change receipt is unchanged except for one added line naming what isolation saved: \`context: <n> stages isolated, ~<k> tokens not re-carried (estimate|exact)\`, read from the \`stage-agent\` rows in the bundle's \`stage-evidence.jsonl\`. Any estimated figure is labelled \`estimate\`, never dressed up as exact.

**Where narration has to go.** Say every \`▸ paqad\` line in your own visible assistant text, and carry the stage lines and the end-of-change receipt into the **final message of the turn**. Two channels look like they work and do not: hook output (below), and your own text emitted mid-turn between tool calls, which the Desktop app does not reliably render. Only the last message of a turn is reliably shown, so a receipt spoken before your last tool call is a receipt the developer never sees.

${HOST_SURFACES_PARAGRAPH}

**Which channels actually render.** Hook narration is belt-and-braces, never the plan:

| Channel | Claude Code CLI | Claude Code Desktop |
| --- | --- | --- |
| Hook \`{systemMessage}\` — PreToolUse | rendered | **rendered as literal \`PreToolUse:<Tool> says:\` lines** |
| Hook \`{systemMessage}\` — Stop | rendered | **rendered as literal \`Stop says:\` lines** |
| Hook \`{decision:'block'}\` \`reason\` | reaches the model only | reaches the model only |
| CLI verb stdout (\`stage start\`, \`plan compile\`) | inside the tool-result block | collapsed — invisible unless expanded |
| Your assistant text, final message of the turn | **rendered** | **rendered** |

A hook \`{systemMessage}\` used to be invisible on Desktop, so paqad kept a narration echo there as belt-and-braces. Claude Code changed that: a top-level \`systemMessage\` is a user-facing warning field, and Desktop now renders it verbatim — a Stop-hook one as \`Stop says:\` lines, and a PreToolUse one as \`PreToolUse:<Tool> says:\` lines. Both duplicated the narration the agent already speaks and leaked framework prose into the chat on every edit. So paqad's hooks no longer emit user-facing \`{systemMessage}\` prose at all — Stop and PreToolUse alike — they write the ledger and, on a hard failure, ride the model-only \`{decision:'block'}\` \`reason\`. The developer-facing channel is your own final message, full stop.

**Per host — who speaks.** On **Claude Code and Codex** YOU speak. Both are the pre-and-completion tier: the stage and gate hooks fire on your edits and at turn end, they block before a mutating edit and write the ledger — but they no longer narrate in chat. Their \`{systemMessage}\` echo was removed once Claude Code began rendering a hook \`{systemMessage}\` on Desktop (a Stop one as \`Stop says:\` lines, a PreToolUse one as \`PreToolUse:<Tool> says:\` lines), because it duplicated the narration you already speak and leaked framework prose to the developer on every edit. Before that it was the opposite failure — the echo was recorded and never shown on Desktop (a full six-stage run once emitted eleven stage lines and the developer saw none of them, while the evidence bundle was complete). Either way the lesson holds. Never treat a hook as having spoken for you. On **Gemini** the record hook is deliberately record-only — it writes the ledger at turn end but says nothing in chat and cannot block — so there too YOU must narrate your own \`▸ paqad\` stage lines and speak the end-of-change verdict in prose. On **advisory hosts** (JetBrains "Claude Agent" / AI Assistant, Cursor, Windsurf, Copilot, Continue, Aider, Antigravity) **no native hook fires at all** — nothing blocks an edit, nothing writes the ledger for you, nothing speaks a verdict. Never rely on a hook-spoken line or a hook-written ledger row on an advisory host. Narrating alone is **not enough**: a narrated-but-unrecorded stage leaves the ledger empty, exactly the JetBrains Claude Agent gap — "framework followed" but "no evidence".

**Advisory-host stage protocol — run the CLI, do not just narrate.** On an advisory host, for any **feature-development** change you MUST populate the ledger yourself by running the host-independent CLI (plain \`paqad-ai …\` in the IDE's shell — no hook required), in this order, and narrate each \`▸ paqad\` stage line as you go. If \`paqad-ai\` is not found, use \`npx paqad-ai\` instead.

\`\`\`
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
\`\`\`

The plan template must record what existing code you checked before building: \`reuse.consulted\` (≥1 entry), \`reuse.reusing\` (may be empty), and \`reuse.new_constructs\` (every new exported construct, justified). \`plan compile\` refuses a template without it, so run \`paqad-ai index query <name>\` — or read the Existing surface section — before you compile.

Then speak the end-of-change verdict (${PAQAD_VERDICT.pass} / ${PAQAD_VERDICT.fail} / ${PAQAD_VERDICT.inconclusive}) in prose, one line per stage with its honest evidence state. Skipping these calls is what leaves the ledger without planning/specification artifacts. If you want the stages **hook-enforced** in a JetBrains IDE rather than self-recorded, use the **Claude Code [Beta] plugin** (it runs the real \`claude\` CLI, so paqad's PreToolUse/Stop hooks fire) — "Claude Agent" in AI Assistant is advisory and structurally exposes no hook layer.

**The end-of-turn check follows the session that owns the change.** When a turn ends, paqad checks a change only in the session that made it: the session whose own stage rows, stamped with its own session id, sit in an unfinished feature bundle. A session that owns no change is skipped, so a question asked in a second window is never held to another window's work. An owner whose turn was not feature-development and who edited nothing that turn is skipped too; the paused change is checked again on the turn that resumes it. Rule-scripts at turn end follow the same decision. So put \`SE_SESSION=<your session id>\` in front of every \`paqad-ai\` call (a feature-development prompt prints the exact line). A call without it can land on another session's id and never counts as your edit.

**A thinking stage must point at its RIGID bundle artifact.** planning, specification, and review each prove their work with a script-written file: end them as \`paqad:stage <stage> end -- <artifact-path>\` (or \`paqad-ai stage end <stage> --artifact <path>\`). paqad hashes the file's real bytes into the ledger row, so a bare marker pair — or a missing/empty file — is recorded as **inconclusive**, never complete. Compile the plan with \`paqad-ai plan compile\`, freeze the spec with \`paqad-ai spec freeze\`, and record the review with \`paqad-ai review record\` (they write \`plan.json\` / \`specification.json\` / \`review.json\` into the active feature's bundle; the legacy \`.paqad/plans/*.md\` and \`.paqad/specs\` free-writes are retired), then end the stage against that file. Any OTHER path is rejected, so a hand-written notes file can never stand in for the real artifact. (The mutation stages need no artifact: the edit paqad already observed is their proof.)

**Never write into a feature bundle directory.** \`.paqad/ledger/feature-evidence/<change>/\` holds only its rigid, script-written artifacts plus the generated \`report.html\`. Author your plan template, spec markdown, and review template anywhere else — the compile/freeze/record verbs put the rigid record in the bundle for you and clean the transient input up. A stage artifact pointing at a non-rigid file inside a bundle dir is rejected, and an Edit or Write aimed inside a bundle dir is denied with the name of the verb that writes that file.

**Code edits are gated on this.** Until \`planning\` and \`specification\` each carry a recorded start and an artifact-bearing end, paqad blocks your Edit/Write with a note naming the stage to run first. Mark the stage — the markers above are parsed before the next edit, so they clear the block in the same turn; from a shell, \`paqad-ai stage start <stage>\` / \`paqad-ai stage end <stage> --artifact <path>\` does the same — and the edit proceeds. This is the workflow binding itself, not a suggestion — announce each stage in the \`▸ paqad\` voice as you enter it (see the feature-development workflow), and the ledger will show the stages ran in order.

### Specification through the pipeline

When \`spec_pipeline_enabled\` is on for the project (the default, together with the experts and strict adoption) and the change is on the graduated or full lane, the specification stage is not "write a spec by hand". A fast-lane change never runs the pipeline and freezes a hand-written spec. A project switches these off with \`spec_pipeline_enabled=false\`, \`spec_pipeline_experts_enabled=false\` or \`spec_pipeline_adoption=warn\`. Otherwise, run the pipeline and let it produce the spec:

\`\`\`
paqad-ai spec pipeline start --request-file <request.md>   # or --ticket <ref>; S0 ground + S1 label in one go
# experts (only when spec_pipeline_experts_enabled is on):
#   run the expert-need-detector skill, then
paqad-ai spec pipeline experts record <need.json>          # records the roster in experts.json
#   seat the High Table: one paqad-expert subagent per seated role, all in parallel (below);
#   each prints its brief with \`paqad-ai spec pipeline experts brief <role>\` (never a file),
#   writes one note for its role with the expert-notes skill, then runs
paqad-ai spec pipeline experts notes <notes.json>
#   when every seat has returned, the paqad-chief-architect subagent reads
#   \`paqad-ai spec pipeline experts context\`, writes the expert-synthesis skill's output, then runs
paqad-ai spec pipeline experts synthesis <synthesis.json>  # each conflict becomes a decision packet
paqad-ai spec pipeline record questions <batch.json>       # skipped when nothing needs asking
paqad-ai spec pipeline record task <task.json>
paqad-ai spec pipeline record craft <spec.md> --trace <trace.json>
paqad-ai spec pipeline finish
paqad-ai spec freeze <spec.md> --from-pipeline --signed-off-by <name> --confirm-invariants
\`\`\`

**Run the High Table as subagents.** On a host that dispatches subagents (Claude Code, Codex), each seated expert runs in its own subagent. After \`experts record\`, dispatch one \`paqad-expert\` subagent per seated role, all in parallel, in one message. Give each its role, the change ref and \`SE_SESSION\`. Each seat runs \`experts brief <role>\`, writes one note for its role only, and runs \`experts notes\`, which merges that role's note and keeps every other role's. Wait until every seat has returned. Then dispatch one \`paqad-chief-architect\` subagent with the change ref and \`SE_SESSION\`; it runs \`experts context\`, writes the synthesis and runs \`experts synthesis\`. paqad records when each seat was seated, started and finished, and the exact tokens its subagent spent, in the change's \`high-table.jsonl\`. A subagent cannot dispatch subagents, so when the specification stage runs in its own agent, that agent returns after \`experts record\` with the seated roles, you dispatch the seats and the chief, then resume that same agent (the resume protocol above) to carry on from the questions step. On a host with no subagents (Gemini, the advisory IDEs) run the expert-notes skill once per brief and the expert-synthesis skill yourself, as before.

The standing experts sit only on the lanes in \`spec_pipeline_experts_lanes\` (default: full). On other lanes \`experts record\` seats only the detector's on-call picks, plus security-auditor when a planned path is sensitive; when nobody is named it skips the High Table, prints one line saying so, and you go straight to the questions step. Speak one \`▸ paqad\` line when experts are seated, naming the standing four and the on-call picks and why: "**▸ paqad** · seated the standing experts (product-owner, application-architect, user-flow-writer, qa-engineer) and brought in db-expert and security-auditor: this reads invoices in bulk and exports a customer's financial data." Under \`spec_pipeline_adoption=strict\` the freeze refuses a spec the pipeline did not produce; \`--manual --reason "<why>"\` is the only exit and it is recorded. Under \`warn\` a hand-written spec still freezes and the receipt says the pipeline was skipped.

## Plain-English translations

Say the right-hand phrasing, never the internal term:

| Internal term | What paqad says |
| --- | --- |
${translationRows}
`;
}

export function buildNarrationContractDocument(): string {
  return `${MANAGED_HEADER}\n\n${buildNarrationContractBody()}`;
}
