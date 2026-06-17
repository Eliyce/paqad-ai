import type { AdapterType } from '@/core/types/adapter.js';

/**
 * One-sentence interactive-UI note rendered into each provider's entry file under
 * the Decision Pause Contract section. The note tells the agent which UI primitive
 * its host exposes for surfacing pending packets — the rest of the contract is
 * provider-agnostic and lives in the managed `.paqad/decision-pause-contract.md`.
 */
export const DECISION_PAUSE_UI_NOTES: Record<AdapterType, string> = {
  'claude-code':
    'In Claude Code, surface the packet via `AskUserQuestion` and wait for the answer.',
  'codex-cli': 'In Codex CLI, prompt the user inline before continuing.',
  antigravity: 'In Antigravity, prompt the user and wait for a reply before continuing.',
  'gemini-cli': 'In Gemini CLI, prompt the user and wait for a reply before continuing.',
  junie: 'In Junie, prompt the user and wait for a reply before continuing.',
  cursor: 'In Cursor, ask the user in chat and wait for a reply before continuing.',
  'github-copilot': 'In Copilot Chat, ask the user and wait for a reply before continuing.',
  windsurf: 'In Windsurf Cascade, ask the user and wait for a reply before continuing.',
  continue: 'In Continue, ask the user and wait for a reply before continuing.',
  aider: 'In Aider, switch to `/ask` mode for the decision and wait for the user.',
};

/**
 * Generic fallback used when an adapter has no first-class interactive UI
 * primitive — defers to the file-wait fallback documented in the managed doc.
 */
export const DECISION_PAUSE_UI_FALLBACK =
  'If no interactive UI is available, stop and wait until `.paqad/decisions/resolved/D-{id}.json` exists.';

export function decisionPauseUiNote(adapter: AdapterType): string {
  return DECISION_PAUSE_UI_NOTES[adapter] ?? DECISION_PAUSE_UI_FALLBACK;
}
