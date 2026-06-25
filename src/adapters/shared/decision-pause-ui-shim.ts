import type { AdapterType } from '@/core/types/adapter.js';

/**
 * One-sentence interactive-UI note for each provider — the UI primitive its host
 * exposes for surfacing a pending decision packet (e.g. the Claude Code
 * `AskUserQuestion` "tray"). The notes are rendered into the per-adapter UI table
 * of the Decision Pause Contract, which is carried inline by the framework
 * bootstrap (`AGENT-BOOTSTRAP.md`). The agent uses the row matching the
 * `Adapter:` footer in the lean entry file that pointed it to the bootstrap
 * (issue #229).
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
