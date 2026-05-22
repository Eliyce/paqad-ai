import { getLegacyCapabilities, getPrimaryStack } from '@/core/stack-profile.js';
import type { Capability } from '@/core/types/domain.js';
import type { McpServerDefinition, McpServerType } from '@/core/types/mcp.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import { getPacksForFrameworks } from '@/packs/project-packs.js';

const MCP_SERVER_CATALOG: Record<
  McpServerType,
  Omit<McpServerDefinition, 'stacks' | 'capabilities'>
> = {
  'laravel-boost': {
    name: 'laravel-boost',
    provides: ['routes', 'models', 'services', 'middleware', 'config'],
    replaces: ['route-scanning', 'model-scanning', 'service-scanning'],
  },
  'dart-mcp': {
    name: 'dart-mcp',
    provides: ['widgets', 'dependencies', 'assets', 'platforms'],
    replaces: ['widget-scanning', 'pubspec-parsing'],
  },
  'database-inspector': {
    name: 'database-inspector',
    provides: ['schema', 'indexes', 'foreign-keys', 'query-plans'],
    replaces: ['migration-scanning'],
  },
  figma: {
    name: 'figma',
    provides: ['design-specs', 'components', 'layouts'],
    replaces: ['web-search-design-research'],
  },
  'vite-inspector': {
    name: 'vite-inspector',
    provides: ['build-graph', 'asset-manifest', 'hmr-config'],
    replaces: ['vite-config-scanning', 'asset-manifest-scanning'],
  },
  'react-router-mcp': {
    name: 'react-router-mcp',
    provides: ['route-tree', 'lazy-chunks', 'navigation-boundaries'],
    replaces: ['manual-route-documentation'],
  },
  'vue-router-mcp': {
    name: 'vue-router-mcp',
    provides: ['route-tree', 'navigation-guards', 'layout-routes'],
    replaces: ['manual-route-documentation'],
  },
  'tailwind-mcp': {
    name: 'tailwind-mcp',
    provides: ['design-tokens', 'utility-classes', 'theme-config'],
    replaces: ['css-web-search', 'manual-tailwind-scanning'],
  },
};

export const MCP_SERVERS: McpServerDefinition[] = [
  { ...MCP_SERVER_CATALOG['laravel-boost'], stacks: ['laravel'], capabilities: ['boost'] },
  { ...MCP_SERVER_CATALOG['dart-mcp'], stacks: ['flutter'], capabilities: [] },
  {
    ...MCP_SERVER_CATALOG['database-inspector'],
    stacks: ['laravel', 'flutter', 'dotnet', 'nestjs', 'kotlin-android'],
    capabilities: [],
  },
  {
    ...MCP_SERVER_CATALOG.figma,
    stacks: [
      'laravel',
      'flutter',
      'react',
      'vue',
      'nextjs',
      'dotnet',
      'flask',
      'nestjs',
      'kotlin-android',
    ],
    capabilities: [],
  },
  { ...MCP_SERVER_CATALOG['vite-inspector'], stacks: ['react', 'vue'], capabilities: [] },
  { ...MCP_SERVER_CATALOG['react-router-mcp'], stacks: ['react'], capabilities: [] },
  { ...MCP_SERVER_CATALOG['vue-router-mcp'], stacks: ['vue'], capabilities: [] },
  {
    ...MCP_SERVER_CATALOG['tailwind-mcp'],
    stacks: ['laravel', 'react', 'vue'],
    capabilities: ['tailwind'],
  },
];

export function getServersForStack(stack: string, capabilities: string[]): McpServerDefinition[] {
  const frameworks = stack === 'short-video' ? [] : [stack];
  return resolveMcpDefaults(frameworks, capabilities as Capability[]);
}

export class McpServerRegistry {
  list(): McpServerDefinition[] {
    return [...MCP_SERVERS];
  }

  forProfile(
    profile: Pick<ProjectProfile, 'routing' | 'stack_profile' | 'mcp' | 'active_capabilities'>,
  ): McpServerDefinition[] {
    const stack = getPrimaryStack(profile);
    if (stack === 'short-video') {
      return [];
    }

    const capabilities = getLegacyCapabilities(profile);
    const frameworks = profile.stack_profile?.frameworks ?? [stack];
    const enabledNames = profile.mcp.servers
      .filter((server) => server.enabled)
      .map((server) => server.name);
    const disabledNames = new Set(
      profile.mcp.servers.filter((server) => !server.enabled).map((server) => server.name),
    );
    const byName = new Map(
      resolveMcpDefaults(frameworks, capabilities).map((server) => [server.name, server] as const),
    );

    for (const name of enabledNames) {
      const explicitServer = buildExplicitServerDefinition(name, frameworks, capabilities);
      if (!explicitServer) {
        continue;
      }

      byName.set(explicitServer.name, explicitServer);
    }

    return Array.from(byName.values()).filter((server) => !disabledNames.has(server.name));
  }
}

function resolveMcpDefaults(
  frameworks: string[],
  capabilities: Capability[],
): McpServerDefinition[] {
  const byName = new Map<McpServerType, McpServerDefinition>();

  for (const framework of frameworks) {
    if (framework === 'laravel' || framework === 'flutter') {
      addServer(byName, 'database-inspector', framework, []);
    }

    addServer(byName, 'figma', framework, []);
  }

  for (const pack of getPacksForFrameworks(frameworks)) {
    for (const item of pack.manifest.mcp_defaults ?? []) {
      if (
        item.when === 'when_trait' &&
        (!item.trait || !capabilities.includes(item.trait as Capability))
      ) {
        continue;
      }

      addServer(
        byName,
        item.name as McpServerType,
        pack.manifest.name,
        item.when === 'when_trait' && item.trait ? [item.trait] : [],
      );
    }
  }

  return Array.from(byName.values());
}

function addServer(
  byName: Map<McpServerType, McpServerDefinition>,
  name: McpServerType,
  stack: string,
  capabilities: string[],
): void {
  const metadata = MCP_SERVER_CATALOG[name];
  if (!metadata) {
    return;
  }

  const existing = byName.get(name);
  if (existing) {
    existing.stacks = Array.from(new Set([...existing.stacks, stack]));
    existing.capabilities = Array.from(new Set([...existing.capabilities, ...capabilities]));
    return;
  }

  byName.set(name, {
    ...metadata,
    stacks: [stack],
    capabilities,
  });
}

function buildExplicitServerDefinition(
  name: string,
  frameworks: string[],
  capabilities: Capability[],
): McpServerDefinition | null {
  if (!(name in MCP_SERVER_CATALOG)) {
    return null;
  }

  const typedName = name as McpServerType;
  const defaults = resolveMcpDefaults(frameworks, capabilities);
  const existing = defaults.find((server) => server.name === typedName);
  if (existing) {
    return existing;
  }

  const metadata = MCP_SERVER_CATALOG[typedName];
  return {
    ...metadata,
    stacks: frameworks,
    capabilities: [],
  };
}
