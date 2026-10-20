import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import Handlebars from 'handlebars';

import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { toPosixPath } from '@/core/path-utils.js';

import {
  HIGH_TABLE_AGENTS,
  MANDATORY_STAGE_AGENTS,
  buildHighTableAgentBody,
  buildStageAgentBody,
  type HighTableAgentDef,
  type StageAgentDef,
} from './stage-agents.js';

interface HostTarget {
  adapter: string;
  agentsSubdir: string;
  extension: 'md' | 'toml';
  template: string;
}

export const STAGE_AGENT_HOSTS: readonly HostTarget[] = [
  {
    adapter: 'claude-code',
    agentsSubdir: '.claude/agents',
    extension: 'md',
    template: 'claude.md.hbs',
  },
  {
    adapter: 'codex-cli',
    agentsSubdir: '.codex/agents',
    extension: 'toml',
    template: 'codex.toml.hbs',
  },
];

export interface WriteStageAgentsOptions {
  homeDir?: string;
}

function agentContext(def: StageAgentDef): Record<string, unknown> {
  return {
    agentName: def.agentName,
    description: `paqad feature-development stage: ${def.ledgerStage}. Dispatched by the paqad orchestrator only.`,
    tools: def.claudeTools,
    body: buildStageAgentBody(def),
  };
}

function highTableAgentContext(def: HighTableAgentDef): Record<string, unknown> {
  return {
    agentName: def.agentName,
    description: def.description,
    tools: def.claudeTools,
    body: buildHighTableAgentBody(def),
  };
}

function allAgentContexts(): { agentName: string; context: Record<string, unknown> }[] {
  return [
    ...MANDATORY_STAGE_AGENTS.map((def) => ({
      agentName: def.agentName,
      context: agentContext(def),
    })),
    ...HIGH_TABLE_AGENTS.map((def) => ({
      agentName: def.agentName,
      context: highTableAgentContext(def),
    })),
  ];
}

export function writeStageAgents(options: WriteStageAgentsOptions = {}): string[] {
  const home = options.homeDir ?? homedir();
  const templatesRoot = getRuntimeTemplatesRoot();
  const written: string[] = [];

  for (const host of STAGE_AGENT_HOSTS) {
    const dir = join(home, host.agentsSubdir);
    mkdirSync(dir, { recursive: true });
    const templateSource = readFileSync(join(templatesRoot, 'stage-agents', host.template), 'utf8');
    const template = Handlebars.compile(templateSource);
    for (const { agentName, context } of allAgentContexts()) {
      const content = template(context);
      const filePath = join(dir, `${agentName}.${host.extension}`);
      writeFileSync(filePath, content, 'utf8');
      written.push(toPosixPath(filePath));
    }
  }
  return written;
}

export function renderClaudePluginStageAgents(): { name: string; content: string }[] {
  const templatesRoot = getRuntimeTemplatesRoot();
  const host = STAGE_AGENT_HOSTS.find((candidate) => candidate.adapter === 'claude-code');
  /* v8 ignore next 3 -- the claude-code host is a static list entry; this guard is defensive */
  if (!host) {
    throw new Error('no claude-code stage-agent host configured');
  }
  const templateSource = readFileSync(join(templatesRoot, 'stage-agents', host.template), 'utf8');
  const template = Handlebars.compile(templateSource);
  return allAgentContexts().map(({ agentName, context }) => ({
    name: `${agentName}.${host.extension}`,
    content: template(context),
  }));
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
