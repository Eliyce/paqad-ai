import type { AuthoringConfig } from '@/authoring/config.js';

import type { AgentSource } from './agent-render.js';

export const SDK_DEFINITION_FIELDS = [
  'description',
  'prompt',
  'tools',
  'disallowedTools',
  'model',
  'skills',
  'memory',
  'maxTurns',
  'effort',
] as const;

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  skills?: string[];
  memory?: string;
  maxTurns?: number;
  effort?: string;
}

export function buildAgentDefinition(source: AgentSource): AgentDefinition {
  const definition: AgentDefinition = { description: source.description, prompt: source.body };
  if (source.tools !== undefined) definition.tools = [...source.tools];
  if (source.disallowedTools !== undefined)
    definition.disallowedTools = [...source.disallowedTools];
  if (source.model !== undefined) definition.model = source.model;
  if (source.skills !== undefined) definition.skills = [...source.skills];
  if (source.memory !== undefined) definition.memory = source.memory;
  if (source.maxTurns !== undefined) definition.maxTurns = source.maxTurns;
  if (source.effort !== undefined) definition.effort = source.effort;
  return definition;
}

export function sdkRunOptions(config: Pick<AuthoringConfig, 'authoring_run_max_cost_usd'>): {
  maxBudgetUsd: number;
} {
  return { maxBudgetUsd: config.authoring_run_max_cost_usd };
}

interface HookCommand {
  event: string;
  matcher: string;
  command: string;
}

function hookCommands(hooks: Record<string, unknown> | undefined): HookCommand[] {
  if (hooks === undefined) return [];
  const commands: HookCommand[] = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as Record<string, unknown>[]) {
      const matcher = typeof entry?.matcher === 'string' ? entry.matcher : '*';
      const inner = Array.isArray(entry?.hooks) ? (entry.hooks as Record<string, unknown>[]) : [];
      for (const hook of inner) {
        if (typeof hook?.command === 'string') {
          commands.push({ event, matcher, command: hook.command });
        }
      }
    }
  }
  return commands;
}

export function uncarriedRules(source: AgentSource): string[] {
  const rules = hookCommands(source.hooks).map(
    (hook) =>
      `hook ${hook.event} (${hook.matcher}): ${hook.command} is enforced by a hook the SDK form cannot carry`,
  );
  if (source.isolation !== undefined) {
    rules.push(`isolation: ${source.isolation} cannot travel in the SDK form`);
  }
  if (source.permissionMode !== undefined) {
    rules.push(`permissionMode: ${source.permissionMode} cannot travel in the SDK form`);
  }
  return rules;
}
