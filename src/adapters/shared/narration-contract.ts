import { normalizeProviderEntryContract } from './provider-entry-contract.js';

const HEADING = '## paqad in your chat';

const POINTER_BODY =
  'See `.paqad/narration-contract.md` for the full voice spec, cadence detail, and the plain-English translation of every internal term.';

/**
 * Builds the narration-contract section rendered into every provider's entry
 * file (CLAUDE.md, AGENTS.md, .cursor/rules, …) — issue #158, collapsed to a
 * pointer in #173.
 *
 * The entry file is the repository entrypoint a developer opens and reads, so
 * this section is intentionally minimal: the heading plus a one-line pointer to
 * the canonical `.paqad/narration-contract.md`, mirroring the Decision Pause
 * Contract pointer exactly. The full voice spec — cadence, voice, format, and
 * the glyph legend — lives in the managed doc, see
 * `src/onboarding/narration-contract-writer.ts`.
 *
 * The body is identical across adapters (paqad sounds like one system
 * everywhere), so there is no per-adapter note here.
 */
export function buildNarrationContractSection(): string {
  return `${HEADING}\n\n${POINTER_BODY}`;
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
