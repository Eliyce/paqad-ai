import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

const AGENT_ENTRY_GATE_SCRIPT = '~/.paqad-ai/current/hooks/agent-entry-gate.sh';
const AGENT_ENTRY_SESSION_START_SCRIPT = '~/.paqad-ai/current/hooks/agent-entry-session-start.sh';

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
  next.hooks = {
    ...hooks,
    PreToolUse: mergeHookList(hooks.PreToolUse, [
      {
        matcher: 'Edit|Write|NotebookEdit',
        hooks: [{ type: 'command', command: AGENT_ENTRY_GATE_SCRIPT }],
      },
    ]),
    SessionStart: mergeHookList(hooks.SessionStart, [
      {
        hooks: [{ type: 'command', command: AGENT_ENTRY_SESSION_START_SCRIPT }],
      },
    ]),
  };
  return next;
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
