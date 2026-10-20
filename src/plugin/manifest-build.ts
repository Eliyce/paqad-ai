import { mergeNativeHooks } from '@/adapters/shared/native-hook-config.js';
import { buildPluginHookChain } from '@/adapters/shared/paqad-hooks.js';
import { renderClaudePluginStageAgents } from '@/stage-isolation/agent-writer.js';

export const PLUGIN_MOD_MODULES = ['./mod/register.tsx'] as const;

export const PLUGIN_MOD_TYPES = './runtime/claude-plugin/mod/types/index.d.ts';

export function buildPluginHooksConfig(): Record<string, unknown> {
  return { ...mergeNativeHooks({}, buildPluginHookChain()), modules: [...PLUGIN_MOD_MODULES] };
}

export function serializePluginHooksJson(): string {
  return `${JSON.stringify(buildPluginHooksConfig(), null, 2)}\n`;
}

export function pluginAgentPaths(): string[] {
  return renderClaudePluginStageAgents().map(
    (agent) => `./runtime/claude-plugin/agents/${agent.name}`,
  );
}

export function buildPluginManifest(packageVersion: string): Record<string, unknown> {
  return {
    name: 'paqad',
    description: "Your team's rules, enforced at edit time, with evidence for every change.",
    version: packageVersion,
    author: { name: 'Eliyce' },
    hooks: './runtime/claude-plugin/hooks.json',
    agents: pluginAgentPaths(),
    skills: './runtime/claude-plugin/skills',
    types: PLUGIN_MOD_TYPES,
  };
}

export function serializePluginManifest(packageVersion: string): string {
  return `${JSON.stringify(buildPluginManifest(packageVersion), null, 2)}\n`;
}

export { renderClaudePluginStageAgents };
