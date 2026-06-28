import { readFileSync } from 'node:fs';
import { join } from 'pathe';

import type { GeneratedFile } from '../adapter.interface.js';
import { completionRecordCommand, PAQAD_RUNTIME_PREFIX } from './paqad-hooks.js';

/** The retired bare-path invocation of the record hook (relied on a shebang +
 *  executable bit, which Windows ignores). Pruned from an existing host config on
 *  re-onboard so the cross-platform `node "<abs>"` command replaces it cleanly
 *  rather than sitting alongside it (issue #240). */
const LEGACY_COMPLETION_COMMANDS = new Set([
  `${PAQAD_RUNTIME_PREFIX}/hooks/verification-record.mjs`,
]);

/**
 * Render paqad's verification-completion hook into a host's *native* hook
 * settings file, under the host's "agent finished a turn" event.
 *
 * This is the core of the cross-provider ledger fix. Claude Code already wires
 * its `Stop` hook in `src/adapters/claude/claude-adapter.ts`; this helper lets
 * the other hook-capable hosts (Codex CLI `Stop`, Gemini CLI `AfterAgent`, …) do
 * the same from one definition, so the evidence ledger is produced on every
 * provider rather than Claude Code alone — and with zero change to any host's
 * prose entry file (CLAUDE.md / AGENTS.md / GEMINI.md). The command is the
 * record-only hook (`PAQAD_COMPLETION_RECORD_SCRIPT`), which writes the ledger
 * but never disrupts the host agent.
 *
 * Idempotent and non-destructive: an existing settings file is parsed
 * tolerantly and every key outside `hooks[event]` is preserved untouched; the
 * paqad hook is appended only when an identical command is not already present,
 * so re-onboarding is a no-op and a user's own hooks survive.
 */
export interface NativeCompletionHookOptions {
  projectRoot: string;
  /** Project-relative path to the host's hook settings file (Codex:
   *  `.codex/hooks.json`; Gemini: `.gemini/settings.json`). */
  settingsPath: string;
  /** The host's native event that fires when the agent finishes a turn (Codex:
   *  `Stop`; Gemini: `AfterAgent`). Verified per host against its own docs. */
  completionEvent: string;
}

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher?: string | null;
  hooks: HookEntry[];
}

type HookEvents = Record<string, HookMatcher[]>;

export function buildNativeCompletionHookFile(options: NativeCompletionHookOptions): GeneratedFile {
  const { projectRoot, settingsPath, completionEvent } = options;
  const command = completionRecordCommand();

  const existing = readJsonObject(join(projectRoot, settingsPath));
  const hooks: HookEvents =
    existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
      ? (existing.hooks as HookEvents)
      : {};

  // Drop the retired bare-path command (Windows-broken) before merging, then
  // remove any matcher group left empty by the prune — clean cutover, no migration.
  const eventGroups = (Array.isArray(hooks[completionEvent]) ? hooks[completionEvent] : [])
    .map((group) => ({
      ...group,
      hooks: (group?.hooks ?? []).filter((hook) => !LEGACY_COMPLETION_COMMANDS.has(hook.command)),
    }))
    .filter((group) => group.hooks.length > 0);
  const alreadyPresent = eventGroups.some((group) =>
    group?.hooks?.some((hook) => hook.command === command),
  );
  const nextGroups = alreadyPresent
    ? eventGroups
    : [...eventGroups, { hooks: [{ type: 'command', command }] }];

  const next = {
    ...existing,
    hooks: { ...hooks, [completionEvent]: nextGroups },
  };

  return {
    path: settingsPath,
    content: `${JSON.stringify(next, null, 2)}\n`,
    autoUpdate: true,
  };
}

/**
 * Read a JSON object from disk, returning `{}` when the file is absent
 * (ENOENT) or unparseable. Single read + ENOENT catch — never
 * `existsSync(path) ? readFileSync(path)`, which is the TOCTOU file-system race
 * CodeQL (`js/file-system-race`) flags.
 */
function readJsonObject(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
