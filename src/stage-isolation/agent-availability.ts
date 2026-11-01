import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { installedPluginsPath, isPluginInstalled } from '@/health/plugin-install.js';

import { MANDATORY_STAGE_AGENTS } from './stage-agents.js';

export type ClaudeStageAgentSource = 'plugin' | 'home';

export interface StageAgentAvailabilityOptions {
  homeDir?: string;
  pluginInstalled?: boolean;
}

export function projectOnboardedForClaudeCode(projectRoot: string): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.paqad', 'onboarding-manifest.json'), 'utf8'),
    ) as { adapter?: unknown };
    return manifest.adapter === 'claude-code';
  } catch {
    return false;
  }
}

export const STAGE_AGENT_MISSING_MESSAGE =
  '**▸ paqad** · stage agents are missing\n' +
  '> 🔴 Needs your attention — Claude Code has neither the paqad plugin agents nor a copy in ' +
  '`~/.claude/agents/`, so a stage cannot be dispatched to its own agent. Install the paqad ' +
  'plugin (`/plugin install paqad@eliyce`) and start a new session. paqad stops here instead ' +
  'of running the stage in the main session.';

export const STAGE_AGENT_MISSING_CONTEXT =
  'paqad stage agents are not available in this Claude Code session. When a stage needs its ' +
  'own agent, stop and show the Developer this message instead of running the stage in the ' +
  `main session:\n\n${STAGE_AGENT_MISSING_MESSAGE}`;

function homeCopyPresent(homeDir: string): boolean {
  return MANDATORY_STAGE_AGENTS.every((def) =>
    existsSync(join(homeDir, '.claude', 'agents', `${def.agentName}.md`)),
  );
}

export function claudeStageAgentSource(
  options: StageAgentAvailabilityOptions = {},
): ClaudeStageAgentSource | null {
  const home = options.homeDir ?? homedir();
  const plugin =
    options.pluginInstalled ??
    isPluginInstalled(
      options.homeDir === undefined
        ? installedPluginsPath()
        : join(home, '.claude', 'plugins', 'installed_plugins.json'),
    );
  if (plugin) return 'plugin';
  return homeCopyPresent(home) ? 'home' : null;
}

export function stageDispatchStopMessage(
  options: StageAgentAvailabilityOptions = {},
): string | null {
  return claudeStageAgentSource(options) === null ? STAGE_AGENT_MISSING_MESSAGE : null;
}

export function stageDispatchStopHookOutput(
  projectRoot: string,
  options: StageAgentAvailabilityOptions = {},
): string | null {
  if (!projectOnboardedForClaudeCode(projectRoot)) return null;
  if (stageDispatchStopMessage(options) === null) return null;
  return `${JSON.stringify({
    systemMessage: STAGE_AGENT_MISSING_MESSAGE,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: STAGE_AGENT_MISSING_CONTEXT,
    },
  })}\n`;
}
