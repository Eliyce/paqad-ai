import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';
import {
  capabilityGateCommand,
  hookCommand,
  PAQAD_LIVE_HOOKS,
  PAQAD_RUNTIME_PREFIX,
} from '../shared/paqad-hooks.js';

// Hook file basenames. Each is rendered to a cross-platform
// `node "<abs>/hooks/<file>"` command via hookCommand() at generate time, so the
// wired command runs on Windows as well as POSIX (issue #240). The hooks live
// only in the framework install (never copied into the project); the single
// global copy resolves the project root from CLAUDE_PROJECT_DIR/pwd.
const AGENT_ENTRY_GATE_HOOK = 'agent-entry-gate.mjs';
const AGENT_ENTRY_PROMPT_GATE_HOOK = 'agent-entry-prompt-gate.mjs';
// Issue #322 — arms deterministic ticket intake when a prompt names a tracker ref.
const TICKET_INTAKE_PROMPT_HOOK = 'ticket-intake-prompt.mjs';
const AGENT_ENTRY_SESSION_START_HOOK = 'agent-entry-session-start.mjs';
// Background, non-blocking forced self-update on every session start.
const SILENT_UPDATE_HOOK = 'silent-update.mjs';

// Hook commands paqad used to generate but no longer does: the POSIX-only `.sh`
// gates, and the bare-path `.mjs` invocations that relied on a shebang/exec-bit
// (both Windows-broken, issue #240). Pruned from an existing settings.json on
// re-onboard so a retired command never lingers beside its `node "<abs>"`
// replacement — a clean cutover with no migration step.
const LEGACY_HOOK_COMMANDS = new Set(
  [
    'agent-entry-gate.sh',
    'agent-entry-prompt-gate.sh',
    'agent-entry-session-start.sh',
    'decision-pause-gate.sh',
    'silent-update.sh',
    'silent-update.mjs',
    'rule-script-enforce.mjs',
    'verification-completion.mjs',
    'verification-record.mjs',
  ].map((file) => `${PAQAD_RUNTIME_PREFIX}/hooks/${file}`),
);

// Hook FILES paqad has fully retired (the capability-kernel replacement, F3).
// Unlike LEGACY_HOOK_COMMANDS — which prunes the bare `~` #240 forms of hooks
// that still ship under a `node "<abs>"` command — these have NO replacement
// command, so an existing config may carry the retired hook in its absolute
// `node "<abs>/hooks/<file>"` form. We prune by basename so re-onboard removes it
// in EITHER form and the replacement (capability-gate.mjs) never double-fires
// beside it. rule-script-enforce.mjs is now subsumed by capability-gate.mjs.
const RETIRED_HOOK_FILES = ['rule-script-enforce.mjs'];

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

  // `.claude/settings.json` is the file Claude executes hooks from; it now carries
  // the absolute, machine-specific `node "<abs>"` command, so it is per-machine.
  protected executedHookConfigFiles(): string[] {
    return ['settings.json'];
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
      hooks: [{ type: 'command', command: hookCommand(hook.hookFile) }],
    }),
  );
  const completion = PAQAD_LIVE_HOOKS.filter((hook) => hook.event === 'completion').map((hook) => ({
    hooks: [{ type: 'command', command: hookCommand(hook.hookFile) }],
  }));

  // Legacy bare/`.sh` commands are pruned from EVERY event (not just SessionStart)
  // so re-onboarding cleanly replaces the Windows-broken invocations everywhere.
  next.hooks = {
    ...hooks,
    PreToolUse: mergeHookList(pruneLegacyHooks(hooks.PreToolUse), [
      {
        matcher: 'Edit|Write|NotebookEdit',
        hooks: [{ type: 'command', command: hookCommand(AGENT_ENTRY_GATE_HOOK) }],
      },
      ...preToolMutation,
      {
        matcher: 'Edit|Write|NotebookEdit',
        hooks: [{ type: 'command', command: capabilityGateCommand('pre-mutation') }],
      },
    ]),
    UserPromptSubmit: mergeHookList(pruneLegacyHooks(hooks.UserPromptSubmit), [
      {
        hooks: [{ type: 'command', command: hookCommand(AGENT_ENTRY_PROMPT_GATE_HOOK) }],
      },
      {
        hooks: [{ type: 'command', command: hookCommand(TICKET_INTAKE_PROMPT_HOOK) }],
      },
    ]),
    SessionStart: mergeHookList(pruneLegacyHooks(hooks.SessionStart), [
      {
        hooks: [{ type: 'command', command: hookCommand(AGENT_ENTRY_SESSION_START_HOOK) }],
      },
      {
        hooks: [{ type: 'command', command: hookCommand(SILENT_UPDATE_HOOK) }],
      },
    ]),
    Stop: mergeHookList(pruneLegacyHooks(hooks.Stop), [
      ...completion,
      { hooks: [{ type: 'command', command: capabilityGateCommand('completion') }] },
    ]),
  };
  return next;
}

/**
 * Drop any hook whose command paqad has retired (e.g. the old `.sh` silent-update
 * path replaced by the `.mjs` one, or a fully-retired hook subsumed by the
 * capability kernel), removing matchers left empty by the prune. Keeps re-onboard
 * from leaving a dangling entry pointing at a hook the framework no longer ships.
 */
function pruneLegacyHooks(list: HookMatcher[] | undefined): HookMatcher[] {
  if (!list) {
    return [];
  }
  return list
    .map((matcher) => ({
      ...matcher,
      hooks: (matcher.hooks ?? []).filter((hook) => !isRetiredCommand(hook.command)),
    }))
    .filter((matcher) => matcher.hooks.length > 0);
}

/**
 * True when a hook command should be pruned on re-onboard: either an exact #240
 * bare-form match, or any command (bare OR absolute `node "<abs>"`) that targets a
 * fully-retired hook file. The latter has no replacement command sharing its
 * basename, so a substring match is safe and removes it in every form.
 */
function isRetiredCommand(command: string): boolean {
  if (LEGACY_HOOK_COMMANDS.has(command)) {
    return true;
  }
  return RETIRED_HOOK_FILES.some((file) => command.includes(file));
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
