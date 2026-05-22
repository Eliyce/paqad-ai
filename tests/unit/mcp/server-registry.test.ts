import { describe, expect, it } from 'vitest';

import { getServersForStack, McpServerRegistry, MCP_SERVERS } from '@/mcp/server-registry.js';

describe('MCP server registry', () => {
  it('all servers have non-empty stacks', () => {
    for (const server of MCP_SERVERS) {
      expect(server.stacks.length).toBeGreaterThan(0);
    }
  });

  it('all servers have non-empty provides', () => {
    for (const server of MCP_SERVERS) {
      expect(server.provides.length).toBeGreaterThan(0);
    }
  });

  it('returns laravel-boost for laravel+boost', () => {
    const servers = getServersForStack('laravel', ['boost']);
    const names = servers.map((server) => server.name);
    expect(names).toContain('laravel-boost');
    expect(names).toContain('database-inspector');
  });

  it('does not return laravel-boost for laravel without boost', () => {
    const servers = getServersForStack('laravel', []);
    const names = servers.map((server) => server.name);
    expect(names).not.toContain('laravel-boost');
    expect(names).toContain('database-inspector');
  });

  it('returns dart-mcp for flutter', () => {
    const servers = getServersForStack('flutter', []);
    const names = servers.map((server) => server.name);
    expect(names).toContain('dart-mcp');
    expect(names).not.toContain('laravel-boost');
  });

  it('returns database-inspector for all coding stacks', () => {
    expect(getServersForStack('laravel', []).map((server) => server.name)).toContain(
      'database-inspector',
    );
    expect(getServersForStack('flutter', []).map((server) => server.name)).toContain(
      'database-inspector',
    );
  });

  it('returns figma for all coding stacks', () => {
    expect(getServersForStack('laravel', []).map((server) => server.name)).toContain('figma');
    expect(getServersForStack('flutter', []).map((server) => server.name)).toContain('figma');
    expect(getServersForStack('react', []).map((server) => server.name)).toContain('figma');
    expect(getServersForStack('vue', []).map((server) => server.name)).toContain('figma');
    expect(getServersForStack('nextjs', []).map((server) => server.name)).toContain('figma');
    expect(getServersForStack('flask', []).map((server) => server.name)).toContain('figma');
    expect(getServersForStack('dotnet', []).map((server) => server.name)).toContain('figma');
  });

  it('returns React frontend MCP defaults for react projects', () => {
    const names = getServersForStack('react', []).map((server) => server.name);
    expect(names).toContain('vite-inspector');
    expect(names).toContain('react-router-mcp');
    expect(names).not.toContain('vue-router-mcp');
  });

  it('returns Vue frontend MCP defaults for vue projects', () => {
    const names = getServersForStack('vue', []).map((server) => server.name);
    expect(names).toContain('vite-inspector');
    expect(names).toContain('vue-router-mcp');
    expect(names).not.toContain('react-router-mcp');
  });

  it('returns tailwind-mcp only when tailwind capability is selected', () => {
    expect(getServersForStack('react', ['tailwind']).map((server) => server.name)).toContain(
      'tailwind-mcp',
    );
    expect(getServersForStack('react', []).map((server) => server.name)).not.toContain(
      'tailwind-mcp',
    );
  });

  it('activates stack-specific database defaults only when the relevant trait is present', () => {
    expect(getServersForStack('dotnet', ['ef-core']).map((server) => server.name)).toContain(
      'database-inspector',
    );
    expect(getServersForStack('dotnet', []).map((server) => server.name)).not.toContain(
      'database-inspector',
    );
    expect(getServersForStack('nextjs', ['prisma']).map((server) => server.name)).toContain(
      'database-inspector',
    );
    expect(getServersForStack('nestjs', ['typeorm']).map((server) => server.name)).toContain(
      'database-inspector',
    );
    expect(getServersForStack('kotlin-android', ['room']).map((server) => server.name)).toContain(
      'database-inspector',
    );
  });

  it('resolves profile defaults from matched pack manifests plus global defaults', () => {
    const servers = new McpServerRegistry().forProfile({
      active_capabilities: ['content', 'coding', 'security'],
      stack_profile: {
        frameworks: ['laravel'],
        traits: ['boost'],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      mcp: { servers: [] },
    });

    const names = servers.map((server) => server.name);
    expect(names).toContain('laravel-boost');
    expect(names).toContain('database-inspector');
    expect(names).toContain('figma');
  });

  it('lets profiles explicitly disable default MCP servers', () => {
    const servers = new McpServerRegistry().forProfile({
      active_capabilities: ['content', 'coding', 'security'],
      stack_profile: {
        frameworks: ['laravel'],
        traits: ['boost'],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      mcp: {
        servers: [{ name: 'figma', enabled: false, config: {} }],
      },
    });

    const names = servers.map((server) => server.name);
    expect(names).toContain('laravel-boost');
    expect(names).toContain('database-inspector');
    expect(names).not.toContain('figma');
  });

  it('adds explicitly enabled non-default MCP servers from the catalog', () => {
    const servers = new McpServerRegistry().forProfile({
      active_capabilities: ['content', 'coding', 'security'],
      stack_profile: {
        frameworks: ['laravel'],
        traits: ['boost'],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      mcp: {
        servers: [{ name: 'react-router-mcp', enabled: true, config: {} }],
      },
    });

    const names = servers.map((server) => server.name);
    expect(names).toContain('laravel-boost');
    expect(names).toContain('database-inspector');
    expect(names).toContain('react-router-mcp');
  });
});
