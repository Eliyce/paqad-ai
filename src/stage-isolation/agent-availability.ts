import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { pluginLoadState } from '@/health/plugin-install.js';

import { MANDATORY_STAGE_AGENTS } from './stage-agents.js';

export type ClaudeStageAgentSource = 'plugin' | 'project' | 'home';

export interface StageAgentAvailabilityOptions {
  homeDir?: string;
  projectRoot?: string;
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
  "paqad's stage agents load from the next session. Start a new session to continue.";

export const STAGE_AGENT_MISSING_CONTEXT =
  'paqad stage agents are not available in this Claude Code session. When a stage needs its ' +
  'own agent, stop and show the Developer this one line instead of running the stage in the ' +
  `main session or handing it to a general agent:\n\n${STAGE_AGENT_MISSING_MESSAGE}`;

function fullCopyPresent(root: string): boolean {
  return MANDATORY_STAGE_AGENTS.every((def) =>
    existsSync(join(root, '.claude', 'agents', `${def.agentName}.md`)),
  );
}

export function claudeStageAgentSource(
  options: StageAgentAvailabilityOptions = {},
): ClaudeStageAgentSource | null {
  const home = options.homeDir ?? homedir();
  const plugin =
    options.pluginInstalled ??
    pluginLoadState(options.projectRoot ?? null, {
      home,
      env: options.homeDir === undefined ? process.env : {},
    }) === 'live';
  if (plugin) return 'plugin';
  if (options.projectRoot !== undefined && fullCopyPresent(options.projectRoot)) return 'project';
  return fullCopyPresent(home) ? 'home' : null;
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
  if (stageDispatchStopMessage({ projectRoot, ...options }) === null) return null;
  return `${JSON.stringify({
    systemMessage: STAGE_AGENT_MISSING_MESSAGE,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: STAGE_AGENT_MISSING_CONTEXT,
    },
  })}\n`;
}
