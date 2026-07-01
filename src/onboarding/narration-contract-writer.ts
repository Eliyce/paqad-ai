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
paqad:stage planning end
\`\`\`

Emit the \`start\` marker as you begin the stage and the \`end\` marker as you finish it (\`paqad:stage <stage> <start|end>\`). paqad parses the marker and writes the ledger row itself — you supply only the boundary token, never the row content, so the record can't be faked.

**Code edits are gated on this.** Until \`planning\` and \`specification\` each carry a recorded start and end, paqad blocks your Edit/Write with a note naming the stage to run first. Mark the stage (the markers above, or run \`scripts/se-mark.ts start <stage>\` / \`end <stage>\` for an immediate mark that clears the block in the same turn) and the edit proceeds. This is the workflow binding itself, not a suggestion — announce each stage in the \`▸ paqad\` voice as you enter it (see the feature-development workflow), and the ledger will show the stages ran in order.

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
