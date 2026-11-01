import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Handlebars from 'handlebars';
import YAML from 'yaml';

import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { CODEX_AGENT_FIELDS, isClaudeModel } from '../lint/fields.js';

export interface AgentHostTarget {
  adapter: string;
  agentsSubdir: string;
  extension: 'md' | 'toml';
  template: string;
}

export const AGENT_HOST_TARGETS: readonly AgentHostTarget[] = [
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

const compiledTemplates = new Map<string, Handlebars.TemplateDelegate>();

export function renderAgentTemplate(
  host: AgentHostTarget,
  context: Record<string, unknown>,
): string {
  const path = join(getRuntimeTemplatesRoot(), 'stage-agents', host.template);
  let template = compiledTemplates.get(path);
  if (template === undefined) {
    template = Handlebars.compile(readFileSync(path, 'utf8'));
    compiledTemplates.set(path, template);
  }
  return template(context);
}

export interface AgentSource {
  name: string;
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  effort?: string;
  maxTurns?: number;
  skills?: string[];
  memory?: string;
  isolation?: string;
  hooks?: Record<string, unknown>;
  cacheTtl?: string;
  permissionMode?: string;
  body: string;
}

export interface RenderProducedAgentOptions {
  permissionApproved?: boolean;
}

export interface ProducedAgentFile {
  adapter: string;
  path: string;
  content: string;
  host_notes: string[];
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string');
    return items.map((item) => item.trim()).filter((item) => item !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function cacheTtlOf(data: Record<string, unknown>): string | undefined {
  const experimental = data.experimental;
  if (experimental && typeof experimental === 'object' && !Array.isArray(experimental)) {
    return text((experimental as Record<string, unknown>).cacheTtl);
  }
  return undefined;
}

export function parseAgentSource(content: string): AgentSource {
  const split = splitSkillFrontmatter(content);
  if (!split.ok) {
    throw new Error(
      `agent file has no valid frontmatter: ${split.message.replace('SKILL.md', 'the agent file')}`,
    );
  }
  const data = split.data;
  const name = text(data.name);
  if (name === undefined) throw new Error('agent file frontmatter has no name');
  const maxTurns = typeof data.maxTurns === 'number' ? data.maxTurns : undefined;
  const hooks =
    data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)
      ? (data.hooks as Record<string, unknown>)
      : undefined;
  const source: AgentSource = {
    name,
    description: text(data.description) ?? '',
    body: split.body.replace(/^\n+/u, ''),
  };
  const tools = stringList(data.tools);
  const disallowedTools = stringList(data.disallowedTools);
  const skills = stringList(data.skills);
  if (tools !== undefined) source.tools = tools;
  if (disallowedTools !== undefined) source.disallowedTools = disallowedTools;
  if (skills !== undefined) source.skills = skills;
  const optional: [keyof AgentSource, string | undefined][] = [
    ['model', text(data.model)],
    ['effort', text(data.effort)],
    ['memory', text(data.memory)],
    ['isolation', text(data.isolation)],
    ['cacheTtl', cacheTtlOf(data)],
    ['permissionMode', text(data.permissionMode)],
  ];
  for (const [key, value] of optional) {
    if (value !== undefined) (source as unknown as Record<string, unknown>)[key] = value;
  }
  if (maxTurns !== undefined) source.maxTurns = maxTurns;
  if (hooks !== undefined) source.hooks = hooks;
  return source;
}

function claudeFrontmatter(
  source: AgentSource,
  options: RenderProducedAgentOptions,
): Record<string, unknown> {
  const data: Record<string, unknown> = { name: source.name, description: source.description };
  if (source.tools !== undefined) data.tools = source.tools.join(', ');
  if (source.disallowedTools !== undefined) {
    data.disallowedTools = source.disallowedTools.join(', ');
  }
  if (source.model !== undefined) data.model = source.model;
  if (source.effort !== undefined) data.effort = source.effort;
  if (source.maxTurns !== undefined) data.maxTurns = source.maxTurns;
  if (source.skills !== undefined) data.skills = source.skills;
  if (source.memory !== undefined) data.memory = source.memory;
  if (source.isolation !== undefined) data.isolation = source.isolation;
  if (source.hooks !== undefined) data.hooks = source.hooks;
  if (source.cacheTtl !== undefined) data.experimental = { cacheTtl: source.cacheTtl };
  if (source.permissionMode !== undefined && options.permissionApproved === true) {
    data.permissionMode = source.permissionMode;
  }
  return data;
}

function renderClaudeAgent(
  source: AgentSource,
  options: RenderProducedAgentOptions,
): { content: string; notes: string[] } {
  const notes: string[] = [];
  if (source.permissionMode !== undefined && options.permissionApproved !== true) {
    notes.push(
      'permissionMode omitted: no resolved authoring.agent_permission packet asked for it, so the agent inherits the session permission mode',
    );
  }
  const yaml = YAML.stringify(claudeFrontmatter(source, options), { lineWidth: 0 });
  return { content: `---\n${yaml}---\n\n${source.body.replace(/\n*$/u, '\n')}`, notes };
}

function tomlBasic(value: string): string {
  return JSON.stringify(value);
}

function tomlMultiline(value: string): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"""', '""\\"');
  return `"""\n${escaped.replace(/\n*$/u, '\n')}"""`;
}

const CODEX_UNSUPPORTED: readonly (keyof AgentSource)[] = [
  'tools',
  'disallowedTools',
  'maxTurns',
  'skills',
  'memory',
  'isolation',
  'hooks',
  'cacheTtl',
  'permissionMode',
];

function renderCodexAgent(source: AgentSource): { content: string; notes: string[] } {
  const lines = [
    `name = ${tomlBasic(source.name)}`,
    `description = ${tomlBasic(source.description)}`,
  ];
  const notes: string[] = [];
  if (source.model !== undefined) {
    if (isClaudeModel(source.model)) {
      notes.push(
        `model omitted: ${source.model} is a Claude Code model, so the Codex agent inherits the parent model`,
      );
    } else {
      lines.push(`model = ${tomlBasic(source.model)}`);
    }
  }
  if (source.effort !== undefined) {
    if ((CODEX_AGENT_FIELDS.efforts as readonly string[]).includes(source.effort)) {
      lines.push(`model_reasoning_effort = ${tomlBasic(source.effort)}`);
    } else {
      notes.push(`effort omitted: Codex has no reasoning effort ${source.effort}`);
    }
  }
  lines.push(`developer_instructions = ${tomlMultiline(source.body)}`);
  notes.push(
    ...CODEX_UNSUPPORTED.filter((key) => source[key] !== undefined).map(
      (key) => `${key} omitted: Codex has no documented field for it`,
    ),
  );
  return { content: `${lines.join('\n')}\n`, notes };
}

function hostOf(host: AgentHostTarget | string): AgentHostTarget {
  if (typeof host !== 'string') return host;
  const found = AGENT_HOST_TARGETS.find((candidate) => candidate.adapter === host);
  if (!found) throw new Error(`no agent host configured for "${host}"`);
  return found;
}

export function renderProducedAgent(
  source: AgentSource,
  host: AgentHostTarget | string,
  options: RenderProducedAgentOptions = {},
): ProducedAgentFile {
  const target = hostOf(host);
  const rendered =
    target.extension === 'md' ? renderClaudeAgent(source, options) : renderCodexAgent(source);
  return {
    adapter: target.adapter,
    path: `${target.agentsSubdir}/${source.name}.${target.extension}`,
    content: rendered.content,
    host_notes: rendered.notes,
  };
}
