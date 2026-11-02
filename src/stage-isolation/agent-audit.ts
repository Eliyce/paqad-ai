import type { AgentAuditSources, RenderedTemplateAgent } from '@/authoring/lint/audit.js';
import { AGENT_HOST_TARGETS } from '@/authoring/package/agent-render.js';
import { resolveStageAgentSettings } from '@/core/framework-config.js';

import { renderStageAgentFiles } from './agent-writer.js';
import { HIGH_TABLE_AGENTS, MANDATORY_STAGE_AGENTS } from './stage-agents.js';

export const PAQAD_DISPATCHED_AGENTS: ReadonlySet<string> = new Set([
  ...MANDATORY_STAGE_AGENTS.map((def) => def.agentName),
  ...HIGH_TABLE_AGENTS.map((def) => def.agentName),
]);

export function codexAgentToMarkdown(content: string): string {
  const name = /^name\s*=\s*"([^"]*)"/mu.exec(content)?.[1] ?? '';
  const description = /^description\s*=\s*"((?:[^"\\]|\\.)*)"/mu.exec(content)?.[1] ?? '';
  const body = /^developer_instructions\s*=\s*"""\n([\s\S]*?)\n"""/mu.exec(content)?.[1] ?? '';
  const quoted = (JSON.parse(`"${description}"`) as string).replaceAll("'", "''");
  return `---\nname: ${name}\ndescription: '${quoted}'\n---\n\n${body}\n`;
}

export function renderTemplateAgents(templatePath: string): RenderedTemplateAgent[] {
  const file = templatePath.split('/').at(-1);
  const host = AGENT_HOST_TARGETS.find((entry) => entry.template === file);
  if (host === undefined) return [];
  const codex = host.extension === 'toml';
  return renderStageAgentFiles(host.adapter, resolveStageAgentSettings()).map((rendered) => {
    const name = rendered.name.replace(/\.[^.]+$/u, '');
    return {
      name,
      path: `${templatePath}#${name}`,
      host: codex ? 'codex' : 'claude-code',
      content: codex ? codexAgentToMarkdown(rendered.content) : rendered.content,
    };
  });
}

export const STAGE_AGENT_AUDIT_SOURCES: AgentAuditSources = {
  renderTemplate: renderTemplateAgents,
  dispatched: PAQAD_DISPATCHED_AGENTS,
};
