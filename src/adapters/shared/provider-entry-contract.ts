import type { AdapterType } from '@/core/types/adapter.js';

import { decisionPauseUiNote } from './decision-pause-ui-shim.js';

const POINTER_BODY =
  'See `.paqad/decision-pause-contract.md` for the full rule, categories, resolution flow, and fallback.';

/**
 * Builds the Decision Pause Contract section rendered into a provider's entry
 * file (CLAUDE.md, AGENTS.md, .cursor/rules, …).
 *
 * The entry file is loaded into every session, so this section is intentionally
 * minimal: a one-line pointer to the canonical `.paqad/decision-pause-contract.md`
 * plus a one-sentence per-adapter UI note. The full procedural detail lives in
 * the managed doc — see `src/onboarding/decision-pause-contract-writer.ts`.
 *
 * When `adapter` is omitted the section is generated without a per-adapter UI
 * note. This keeps the existing zero-arg call sites (health checks, legacy
 * tests) working while adapters that have been migrated to the pointer shape
 * render their note.
 */
export function buildDecisionPauseContractSection(adapter?: AdapterType): string {
  const note = adapter ? `\n\n${decisionPauseUiNote(adapter)}` : '';
  return `## Decision Pause Contract\n\n${POINTER_BODY}${note}`;
}

export function normalizeProviderEntryContract(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

/**
 * Extracts the Decision Pause Contract block from an entry file. Tolerates
 * both the new pointer shape and the legacy block (rule paragraph and/or
 * Categories: list) so health checks keep working during the rollout.
 */
export function extractDecisionPauseContractSection(content: string): string | null {
  const normalized = normalizeProviderEntryContract(content);
  const marker = '## Decision Pause Contract';
  const start = normalized.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const endMarker = '\n\nAdapter:\n';
  const end = normalized.indexOf(endMarker, start);
  return end === -1 ? normalized.slice(start).trim() : normalized.slice(start, end).trim();
}

/**
 * Returns the adapter-agnostic pointer body shared by every provider entry
 * file. Used by the cross-adapter determinism test, which asserts the body is
 * identical across adapters even though the per-adapter UI note differs.
 */
export function decisionPauseContractPointerBody(): string {
  return POINTER_BODY;
}
