import { mergeNativeHooks } from '@/adapters/shared/native-hook-config.js';
import { buildPluginHookChain } from '@/adapters/shared/paqad-hooks.js';
import { renderClaudePluginStageAgents } from '@/stage-isolation/agent-writer.js';

export const PLUGIN_MOD_MODULES = ['./mod/register.tsx'] as const;

export const PLUGIN_MOD_TYPES = './runtime/claude-plugin/mod/types/index.d.ts';

export const PLUGIN_ICON = './assets/icon.png';

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
    displayName: 'paqad',
    description: "Your team's rules, enforced at edit time, with evidence for every change.",
    version: packageVersion,
    author: { name: 'Eliyce', email: 'hello@eliyce.com', url: 'https://eliyce.com' },
    homepage: 'https://paqad.ai',
    repository: 'https://github.com/Eliyce/paqad-claude-plugin',
    license: 'MIT',
    keywords: ['governance', 'code-review', 'evidence', 'rules', 'quality-gates', 'compliance'],
    icon: PLUGIN_ICON,
    documentationUrl: 'https://paqad.ai/docs/',
    supportUrl: 'https://paqad.ai/support/',
    privacyPolicyUrl: 'https://paqad.ai/privacy/',
    termsOfServiceUrl: 'https://paqad.ai/terms/',
    hooks: './runtime/claude-plugin/hooks.json',
    agents: pluginAgentPaths(),
    skills: './runtime/claude-plugin/skills',
    types: PLUGIN_MOD_TYPES,
    userConfig: {
      openai_api_key: {
        type: 'string',
        title: 'OpenAI API key',
        description:
          'Only needed if you set rag_embedding_provider=openai. Stored in your system credential store.',
        sensitive: true,
        required: false,
      },
      cohere_api_key: {
        type: 'string',
        title: 'Cohere API key',
        description:
          'Only needed if you turn on reranking with the cohere backend. Stored in your system credential store.',
        sensitive: true,
        required: false,
      },
    },
  };
}

export function serializePluginManifest(packageVersion: string): string {
  return `${JSON.stringify(buildPluginManifest(packageVersion), null, 2)}\n`;
}

export { renderClaudePluginStageAgents };
