import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import { PAQAD_LIVE_HOOKS } from '../shared/paqad-hooks.js';

const AGENT_ENTRY_GATE_SCRIPT = '~/.paqad-ai/current/hooks/agent-entry-gate.sh';
const AGENT_ENTRY_PROMPT_GATE_SCRIPT = '~/.paqad-ai/current/hooks/agent-entry-prompt-gate.sh';
const AGENT_ENTRY_SESSION_START_SCRIPT = '~/.paqad-ai/current/hooks/agent-entry-session-start.sh';
// Background, non-blocking forced self-update on every session start. Resolves
// the project root from CLAUDE_PROJECT_DIR/pwd, so the single global copy under
// ~/.paqad-ai/current operates on whichever project the session is in. The hook
// lives only in the framework install (never copied into the project) and is now
// a cross-platform Node script.
const SILENT_UPDATE_SESSION_START_SCRIPT = '~/.paqad-ai/current/hooks/silent-update.mjs';
// RAG buildout F6 — live rule-script enforcement. Registered for both PreToolUse
// (Edit/Write/NotebookEdit) and Stop so scripted-rule violations are caught from
// the working tree even when the rule text is not loaded into context.
const RULE_SCRIPT_ENFORCE_SCRIPT = '~/.paqad-ai/current/hooks/rule-script-enforce.mjs';

// Hook commands paqad used to generate but no longer does. Pruned from an
// existing settings.json on re-onboard so a renamed/removed hook does not leave
// a dangling SessionStart entry that fails every session.
const LEGACY_HOOK_COMMANDS = new Set(['~/.paqad-ai/current/hooks/silent-update.sh']);

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly type = 'claude-code' as const;

  protected configTemplateName() {
    return 'claude.md.hbs';
  }
  protected configOutputPath() {
    return 'CLAUDE.md';
  }
  protected skillsRoot() {
    return '.claude/skills';
  }
  protected agentsRoot() {
    return '.claude/agents';
  }
  protected hooksOutputPath() {
    return '.claude/settings.hooks.json';
  }
  protected mcpOutputPath() {
    return '.claude/settings.mcp.json';
  }
  protected cacheOutputPath() {
    return '.claude/cache.json';
  }
  protected memoryOutputPath() {
    return '.claude/memory.json';
  }

  async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    return [...base, buildAgentEntryGateSettings(context.projectRoot)];
  }
}

function buildAgentEntryGateSettings(projectRoot: string): GeneratedFile {
  const settingsPath = '.claude/settings.json';
  const existingPath = join(projectRoot, settingsPath);
  const existing = existsSync(existingPath) ? safeParse(existingPath) : {};
  const merged = mergeAgentEntryGate(existing);
  return {
    path: settingsPath,
    content: `${JSON.stringify(merged, null, 2)}\n`,
    autoUpdate: true,
  };
}

function safeParse(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

type HookEvents = Record<string, HookMatcher[]>;

function mergeAgentEntryGate(existing: Record<string, unknown>): Record<string, unknown> {
  const next = { ...existing };
  const hooks = (next.hooks && typeof next.hooks === 'object' ? next.hooks : {}) as HookEvents;

  // Render the single-definition #117 live hooks (decision-pause PreToolUse +
  // verification-completion Stop) into Claude's settings.json shape, alongside
  // the pre-existing agent-entry gates.
  const preToolMutation = PAQAD_LIVE_HOOKS.filter((hook) => hook.event === 'pre-tool-mutation').map(
    (hook) => ({
      matcher: hook.mutatingToolMatcher,
      hooks: [{ type: 'command', command: hook.script }],
    }),
  );
  const completion = PAQAD_LIVE_HOOKS.filter((hook) => hook.event === 'completion').map((hook) => ({
    hooks: [{ type: 'command', command: hook.script }],
  }));

  next.hooks = {
    ...hooks,
    PreToolUse: mergeHookList(hooks.PreToolUse, [
      {
        matcher: 'Edit|Write|NotebookEdit',
        hooks: [{ type: 'command', command: AGENT_ENTRY_GATE_SCRIPT }],
      },
      ...preToolMutation,
      {
        matcher: 'Edit|Write|NotebookEdit',
        hooks: [{ type: 'command', command: RULE_SCRIPT_ENFORCE_SCRIPT }],
      },
    ]),
    UserPromptSubmit: mergeHookList(hooks.UserPromptSubmit, [
      {
        hooks: [{ type: 'command', command: AGENT_ENTRY_PROMPT_GATE_SCRIPT }],
      },
    ]),
    SessionStart: mergeHookList(pruneLegacyHooks(hooks.SessionStart), [
      {
        hooks: [{ type: 'command', command: AGENT_ENTRY_SESSION_START_SCRIPT }],
      },
      {
        hooks: [{ type: 'command', command: SILENT_UPDATE_SESSION_START_SCRIPT }],
      },
    ]),
    Stop: mergeHookList(hooks.Stop, [
      ...completion,
      { hooks: [{ type: 'command', command: RULE_SCRIPT_ENFORCE_SCRIPT }] },
    ]),
  };
  return next;
}

/**
 * Drop any hook whose command paqad has retired (e.g. the old `.sh` silent-update
 * path replaced by the `.mjs` one), removing matchers left empty by the prune.
 * Keeps re-onboard from leaving a dangling SessionStart entry pointing at a hook
 * the framework no longer ships.
 */
function pruneLegacyHooks(list: HookMatcher[] | undefined): HookMatcher[] {
  if (!list) {
    return [];
  }
  return list
    .map((matcher) => ({
      ...matcher,
      hooks: (matcher.hooks ?? []).filter((hook) => !LEGACY_HOOK_COMMANDS.has(hook.command)),
    }))
    .filter((matcher) => matcher.hooks.length > 0);
}

function mergeHookList(
  existing: HookMatcher[] | undefined,
  paqadEntries: HookMatcher[],
): HookMatcher[] {
  const merged = [...(existing ?? [])];
  for (const entry of paqadEntries) {
    const paqadCommands = new Set(entry.hooks.map((hook) => hook.command));
    const alreadyPresent = merged.some((candidate) =>
      candidate.hooks?.some((hook) => paqadCommands.has(hook.command)),
    );
    if (!alreadyPresent) {
      merged.push(entry);
    }
  }
  return merged;
}
