import {
  PAQAD_STATUS_GLYPH,
  PAQAD_STATUS_LABEL,
  PAQAD_TERM_TRANSLATIONS,
  PAQAD_VERDICT,
  paqadFrameLead,
  type PaqadStatusKind,
} from '@/core/constants/paqad-voice.js';

import { MANAGED_HEADER } from './decision-pause-contract-writer.js';

/**
 * Builds the narration-contract BODY (issue #158) — the full spec for how paqad
 * speaks in the live agent chat, WITHOUT the managed header. This body is the
 * single source of truth for the contract: the framework bootstrap
 * (`runtime/AGENT-BOOTSTRAP.md`, assembled by
 * `src/onboarding/agent-bootstrap-writer.ts`) inlines it so the contract ships
 * inside the framework install and is loaded from there — it is no longer copied
 * into every project's `.paqad/` (issue #229).
 *
 * The glyphs, verdict words, status-block frame, and term translations are all
 * sourced from the canonical `paqad-voice` spec, so this body, the PR evidence
 * comment, and the dashboard can never drift apart.
 */
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

When you run the feature-development workflow, record each stage as you enter and finish it, so the stage-evidence ledger proves the workflow actually ran (not just that you said it did). Stages that touch files are recorded for you automatically as you edit — \`development\` (a source edit), \`checks\` (a test edit), \`documentation_sync\` (a doc edit), \`specification\` (a spec/contract edit). The stages that produce no file change — **planning**, **specification** (when it is thinking, not a written spec), and **review** — you mark with a control line on its own line, in exactly this form:

\`\`\`
paqad:stage planning start
… planning work …
paqad:stage planning end -- <plan.json>   # compile it first with \`paqad-ai plan compile\`
\`\`\`

Emit the \`start\` marker as you begin the stage and the \`end\` marker as you finish it (\`paqad:stage <stage> <start|end>\`). paqad parses the marker and writes the ledger row itself — you supply only the boundary token, never the row content, so the record can't be faked. Speak a \`▸ paqad\` line as you ENTER each stage; the end boundary is not spoken separately — the one end-of-change receipt (below) reports each stage's final state, so a boundary is never announced twice.

**One end-of-change receipt.** At the end of a change you speak a single receipt, in the turn's final message: the verdict in the contract words (${PAQAD_VERDICT.pass} / ${PAQAD_VERDICT.fail} / ${PAQAD_VERDICT.inconclusive}), then one line per stage with a fixed glyph and its honest evidence state. A stage that was only marked — no artifact, or a near-zero duration that proves no work happened — reads ${PAQAD_STATUS_GLYPH.needsLook} "marked (no recorded work)", never ${PAQAD_STATUS_GLYPH.good} "done". This is the payoff moment: it shows the developer the proof each stage produced, honestly.

**Where narration has to go.** Say every \`▸ paqad\` line in your own visible assistant text, and carry the stage lines and the end-of-change receipt into the **final message of the turn**. Two channels look like they work and do not: hook output (below), and your own text emitted mid-turn between tool calls, which the Desktop app does not reliably render. Only the last message of a turn is reliably shown, so a receipt spoken before your last tool call is a receipt the developer never sees.

**Which channels actually render.** Hook narration is belt-and-braces, never the plan:

| Channel | Claude Code CLI | Claude Code Desktop |
| --- | --- | --- |
| Hook \`{systemMessage}\` (PreToolUse / Stop) | rendered | **not rendered** — recorded as a hook attachment |
| Hook \`{decision:'block'}\` \`reason\` | reaches the model only | reaches the model only |
| CLI verb stdout (\`stage start\`, \`plan compile\`) | inside the tool-result block | collapsed — invisible unless expanded |
| Your assistant text, final message of the turn | **rendered** | **rendered** |

**Per host — who speaks.** On **Claude Code** YOU speak. The stage hooks do fire on your edits and at turn end, and they do write the ledger — but their narration rides \`{systemMessage}\`, so on Desktop it is recorded and never shown (issue #409: a full six-stage run emitted eleven stage lines and the developer saw none of them, while the evidence bundle was complete). Never treat a hook as having spoken for you. On **Codex** and **Gemini** the record hook is deliberately record-only — it writes the ledger at turn end but says nothing in chat — so there too YOU must narrate your own \`▸ paqad\` stage lines and speak the end-of-change verdict in prose. On **advisory hosts** (JetBrains "Claude Agent" / AI Assistant, Cursor, Windsurf, Copilot, Continue, Aider, Antigravity) **no native hook fires at all** — nothing blocks an edit, nothing writes the ledger for you, nothing speaks a verdict. Never rely on a hook-spoken line or a hook-written ledger row on an advisory host. Narrating alone is **not enough**: a narrated-but-unrecorded stage leaves the ledger empty, exactly the JetBrains Claude Agent gap (issue #389) — "framework followed" but "no evidence".

**Advisory-host stage protocol — run the CLI, do not just narrate.** On an advisory host, for any **feature-development** change you MUST populate the ledger yourself by running the host-independent CLI (plain \`npx paqad-ai …\` in the IDE's shell — no hook required), in this order, and narrate each \`▸ paqad\` stage line as you go:

\`\`\`
npx paqad-ai stage start planning
… planning work …
npx paqad-ai plan compile <plan-template.json>            # writes plan.json into the active feature bundle
                                                          # the template MUST carry a "reuse" section (#357)
npx paqad-ai stage end planning --artifact <plan.json>

npx paqad-ai stage start specification
… write the spec …
npx paqad-ai spec freeze <spec.md> --confirm-invariants   # writes specification.json into the bundle
npx paqad-ai stage end specification --artifact <specification.json>

npx paqad-ai stage start review
… review the change …
npx paqad-ai review record <review-template.json>         # writes review.json into the bundle
npx paqad-ai stage end review --artifact <review.json>

# development / checks / documentation_sync record from the files you edit where a hook
# exists; on an advisory host mark them the same way.
\`\`\`

The plan template must record what existing code you checked before building (issue #357): \`reuse.consulted\` (≥1 entry), \`reuse.reusing\` (may be empty), and \`reuse.new_constructs\` (every new exported construct, justified). \`plan compile\` refuses a template without it, so run \`npx paqad-ai index query <name>\` — or read the Existing surface section — before you compile.

Then speak the end-of-change verdict (${PAQAD_VERDICT.pass} / ${PAQAD_VERDICT.fail} / ${PAQAD_VERDICT.inconclusive}) in prose, one line per stage with its honest evidence state. Skipping these calls is what leaves the ledger without planning/specification artifacts. If you want the stages **hook-enforced** in a JetBrains IDE rather than self-recorded, use the **Claude Code [Beta] plugin** (it runs the real \`claude\` CLI, so paqad's PreToolUse/Stop hooks fire) — "Claude Agent" in AI Assistant is advisory and structurally exposes no hook layer.

**A thinking stage must point at its RIGID bundle artifact.** planning, specification, and review each prove their work with a script-written file: end them as \`paqad:stage <stage> end -- <artifact-path>\` (or \`npx paqad-ai stage end <stage> --artifact <path>\`). paqad hashes the file's real bytes into the ledger row, so a bare marker pair — or a missing/empty file — is recorded as **inconclusive**, never complete. Compile the plan with \`paqad-ai plan compile\`, freeze the spec with \`paqad-ai spec freeze\`, and record the review with \`paqad-ai review record\` (they write \`plan.json\` / \`specification.json\` / \`review.json\` into the active feature's bundle; the legacy \`.paqad/plans/*.md\` and \`.paqad/specs\` free-writes are retired), then end the stage against that file. Any OTHER path is rejected, so a hand-written notes file can never stand in for the real artifact. (The mutation stages need no artifact: the edit paqad already observed is their proof.)

**Never write into a feature bundle directory.** \`.paqad/ledger/feature-evidence/<change>/\` holds only its rigid, script-written artifacts plus the generated \`report.html\`. Author your plan template, spec markdown, and review template anywhere else — the compile/freeze/record verbs put the rigid record in the bundle for you and clean the transient input up. A stage artifact pointing at a non-rigid file inside a bundle dir is rejected.

**Code edits are gated on this.** Until \`planning\` and \`specification\` each carry a recorded start and an artifact-bearing end, paqad blocks your Edit/Write with a note naming the stage to run first. Mark the stage — the markers above are parsed before the next edit, so they clear the block in the same turn; from a shell, \`npx paqad-ai stage start <stage>\` / \`npx paqad-ai stage end <stage> --artifact <path>\` does the same — and the edit proceeds. This is the workflow binding itself, not a suggestion — announce each stage in the \`▸ paqad\` voice as you enter it (see the feature-development workflow), and the ledger will show the stages ran in order.

## Plain-English translations

Say the right-hand phrasing, never the internal term:

| Internal term | What paqad says |
| --- | --- |
${translationRows}
`;
}

/**
 * The narration contract as a standalone managed document (header + body). Kept
 * for callers/tests that want the document form; the project-level `.paqad/`
 * copy is no longer written (issue #229).
 */
export function buildNarrationContractDocument(): string {
  return `${MANAGED_HEADER}\n\n${buildNarrationContractBody()}`;
}
