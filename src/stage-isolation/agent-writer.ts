import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_HOST_TARGETS,
  renderAgentTemplate,
  type AgentHostTarget,
} from '@/authoring/package/agent-render.js';
import { resolveStageAgentSettings, type StageAgentSetting } from '@/core/framework-config.js';
import { toPosixPath } from '@/core/path-utils.js';

import {
  HIGH_TABLE_AGENTS,
  MANDATORY_STAGE_AGENTS,
  buildHighTableAgentBody,
  buildStageAgentBody,
  type HighTableAgentDef,
  type StageAgentDef,
} from './stage-agents.js';

type HostTarget = AgentHostTarget;

export const STAGE_AGENT_HOSTS: readonly HostTarget[] = AGENT_HOST_TARGETS;

export interface WriteStageAgentsOptions {
  homeDir?: string;
  pluginInstalled?: boolean;
}

export const STAGE_AGENT_MARKER =
  '<!-- paqad-ai managed agent: paqad rewrites this file, so edits here are lost -->';

export function withManagedMarker(content: string): string {
  const close = content.startsWith('---\n') ? content.indexOf('\n---\n', 4) : -1;
  if (close < 0) return `${STAGE_AGENT_MARKER}\n${content}`;
  const end = close + '\n---\n'.length;
  return `${content.slice(0, end)}${STAGE_AGENT_MARKER}\n${content.slice(end)}`;
}

const CLAUDE_CODE_ADAPTER = 'claude-code';

function agentContext(
  def: StageAgentDef,
  setting: StageAgentSetting,
  adapter: string,
): Record<string, unknown> {
  return {
    agentName: def.agentName,
    description: def.description,
    tools: def.claudeTools,
    maxTurns: def.maxTurns,
    model: setting.model,
    effort: setting.effort === 'inherit' ? undefined : setting.effort,
    omitClaudeMd: adapter === CLAUDE_CODE_ADAPTER,
    body: buildStageAgentBody(def, adapter),
  };
}

function highTableAgentContext(def: HighTableAgentDef): Record<string, unknown> {
  return {
    agentName: def.agentName,
    description: def.description,
    tools: def.claudeTools,
    maxTurns: def.maxTurns,
    model: 'inherit',
    body: buildHighTableAgentBody(def),
  };
}

function allAgentContexts(
  adapter: string,
  settings: Record<string, StageAgentSetting> = resolveStageAgentSettings(),
): { agentName: string; context: Record<string, unknown> }[] {
  return [
    ...MANDATORY_STAGE_AGENTS.map((def) => ({
      agentName: def.agentName,
      context: agentContext(def, settings[def.ledgerStage]!, adapter),
    })),
    ...HIGH_TABLE_AGENTS.map((def) => ({
      agentName: def.agentName,
      context: highTableAgentContext(def),
    })),
  ];
}

function renderHostAgents(
  host: HostTarget,
  settings?: Record<string, StageAgentSetting>,
): { name: string; content: string }[] {
  return allAgentContexts(host.adapter, settings).map(({ agentName, context }) => ({
    name: `${agentName}.${host.extension}`,
    content: renderAgentTemplate(host, context),
  }));
}

export function renderStageAgentFiles(
  adapter: string,
  settings?: Record<string, StageAgentSetting>,
): { name: string; content: string }[] {
  const host = STAGE_AGENT_HOSTS.find((candidate) => candidate.adapter === adapter);
  if (!host) {
    throw new Error(`no stage-agent host configured for "${adapter}"`);
  }
  return renderHostAgents(host, settings);
}

export function writeStageAgents(options: WriteStageAgentsOptions = {}): string[] {
  const home = options.homeDir ?? homedir();
  const written: string[] = [];
  for (const host of STAGE_AGENT_HOSTS) {
    const claude = host.adapter === CLAUDE_CODE_ADAPTER;
    if (claude && options.pluginInstalled === true) continue;
    const dir = join(home, host.agentsSubdir);
    mkdirSync(dir, { recursive: true });
    for (const { name, content } of renderHostAgents(host)) {
      const filePath = join(dir, name);
      writeFileSync(filePath, claude ? withManagedMarker(content) : content, 'utf8');
      written.push(toPosixPath(filePath));
    }
  }
  return written;
}

export function renderClaudePluginStageAgents(): { name: string; content: string }[] {
  return renderStageAgentFiles(CLAUDE_CODE_ADAPTER);
}

export function writeClaudePluginStageAgents(destDir: string): string[] {
  mkdirSync(destDir, { recursive: true });
  const written: string[] = [];
  for (const { name, content } of renderClaudePluginStageAgents()) {
    const filePath = join(destDir, name);
    writeFileSync(filePath, content, 'utf8');
    written.push(toPosixPath(filePath));
  }
  return written;
}
