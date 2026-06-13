import { paqadFrameLead, paqadGlyphLegend } from '@/core/constants/paqad-voice.js';

import { normalizeProviderEntryContract } from './provider-entry-contract.js';

const HEADING = '## paqad in your chat';

const POINTER_BODY =
  'See `.paqad/narration-contract.md` for the full voice spec, cadence detail, and the plain-English translation of every internal term.';

/**
 * Builds the narration-contract section rendered into every provider's entry
 * file (CLAUDE.md, AGENTS.md, .cursor/rules, …) — issue #158.
 *
 * Unlike the Decision Pause Contract (a one-line pointer, because the agent
 * only needs it when a pause actually fires), the narration rules must be
 * in-context on every turn for the agent to follow them, so this section is
 * self-contained: cadence, voice, format, and the shared glyph legend, plus a
 * pointer to the canonical `.paqad/narration-contract.md` for the full term
 * translations. It is still kept lean per the feature's own guardrail — the
 * developer-facing output it produces must never become noise.
 *
 * The body is identical across adapters (paqad sounds like one system
 * everywhere); the cross-agent rendering rule is universal — markdown
 * structure, never ANSI colour — so there is no per-adapter note here.
 *
 * The glyph legend is sourced from `paqad-voice` so it can never drift from the
 * PR evidence comment or the dashboard.
 */
export function buildNarrationContractSection(): string {
  return `${HEADING}

paqad runs the orchestration behind your agent: it classifies the request, routes it to a lane, derives the requirements, runs the verification gates, and holds the quality ratchet. Make that work visible so the developer feels the layer working for them. Speak as paqad — first person, addressed to the developer — not as the model narrating itself.

Speak only at substantive transitions, never on every line:

- **Handshake (once per session):** name paqad and frame it as the layer in charge. This is the one full-name anchor.
- **On a real decision:** when you classify, pick a lane, derive requirements, or run/skip a gate. One compact line — the proactive choice you made, not an echo of the prompt.
- **On a verdict:** when verification, mutation, or the quality ratchet produces a result, especially a problem you caught. Honest and plain.
- **On a pause:** when the Decision Pause Contract fires.

Voice: first person, framing the work as done on the developer's behalf ("checked for you", "caught this before it shipped"). Translate every internal term to plain language — no jargon. Be honest on bad outcomes: never dress up a failure, and surface caught problems as prominently as green checks so trust stays calibrated, never inflated. Name "paqad" about once per session plus once per genuinely valuable verdict; everywhere else let the status frame below carry the recognition.

Format — a markdown status block. Rely on markdown structure (headings, bold, blockquotes, task lists, emoji), never ANSI colour, and keep every line legible with the glyphs stripped:

\`\`\`
${paqadFrameLead('<short label>')}
> One plain sentence, on the developer's behalf.
> - 🟢 a status line — the words carry the meaning, the glyph only reinforces it
\`\`\`

Status glyphs carry fixed, reserved meaning, reused from the paqad evidence comment: ${paqadGlyphLegend()}.

${POINTER_BODY}`;
}

/**
 * Extracts the narration-contract block from an entry file, or `null` when the
 * section is absent. Ends at the next top-level heading or the `Adapter:`
 * footer, whichever comes first — so it stays correct regardless of what
 * follows (the Decision Pause Contract is rendered right after it).
 */
export function extractNarrationContractSection(content: string): string | null {
  const normalized = normalizeProviderEntryContract(content);
  const start = normalized.indexOf(HEADING);
  if (start === -1) {
    return null;
  }
  const afterHeading = start + HEADING.length;
  const rest = normalized.slice(afterHeading);
  const ends = [rest.indexOf('\n\n## '), rest.indexOf('\n\nAdapter:\n')].filter((i) => i !== -1);
  if (ends.length === 0) {
    return normalized.slice(start).trim();
  }
  return normalized.slice(start, afterHeading + Math.min(...ends)).trim();
}

/**
 * The adapter-agnostic pointer body shared by every provider entry file. Used
 * by the cross-adapter determinism test, which asserts the body is identical
 * across adapters.
 */
export function narrationContractPointerBody(): string {
  return POINTER_BODY;
}
