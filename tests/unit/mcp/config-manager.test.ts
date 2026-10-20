import { describe, expect, it } from 'vitest';

import type { McpRecommendations } from '@/core/types/mcp.js';
import { LEGACY_MCP_OUTPUT_PATHS, McpConfigManager } from '@/mcp/config-manager.js';

import { fixtureProfile } from './shared.fixture.js';

function names(content: string): string[] {
  return (JSON.parse(content) as McpRecommendations).servers.map((server) => server.name);
}

describe('McpConfigManager', () => {
  const manager = new McpConfigManager();

  it('writes recommendations to paqad’s own file, never a host MCP path', () => {
    const file = manager.generate(fixtureProfile('laravel'));

    expect(file.path).toBe('.paqad/mcp-recommendations.json');
    expect(Object.values(LEGACY_MCP_OUTPUT_PATHS)).not.toContain(file.path);
    expect(names(file.content)).toEqual(
      expect.arrayContaining(['laravel-boost', 'database-inspector']),
    );
  });

  it('carries only name, provides, replaces and why on each server (AC-9)', () => {
    const parsed = JSON.parse(
      manager.generate(fixtureProfile('laravel')).content,
    ) as McpRecommendations;

    expect(Object.keys(parsed)).toEqual(['servers']);
    for (const server of parsed.servers) {
      expect(Object.keys(server).sort()).toEqual(['name', 'provides', 'replaces', 'why']);
      expect(server.why).toBe('laravel project');
    }
    const boost = parsed.servers.find((server) => server.name === 'laravel-boost');
    expect(boost?.provides).toContain('routes');
    expect(boost?.replaces).toContain('route-scanning');
  });

  it('omits servers the profile explicitly disables', () => {
    expect(names(manager.generate(fixtureProfile('laravel')).content)).not.toContain('figma');
  });

  it('includes explicitly enabled non-default servers without copying their config', () => {
    const profile = fixtureProfile('laravel');
    profile.mcp.servers = [
      { name: 'figma', enabled: false, config: {} },
      { name: 'react-router-mcp', enabled: true, config: { command: 'npx', mode: 'team-only' } },
    ];

    const content = manager.generate(profile).content;

    expect(names(content)).toContain('react-router-mcp');
    expect(names(content)).not.toContain('figma');
    expect(content).not.toContain('command');
    expect(content).not.toContain('team-only');
  });

  it('recommends Dart MCP for flutter and not Laravel Boost', () => {
    const recommended = names(manager.generate(fixtureProfile('flutter')).content);

    expect(recommended).toContain('dart-mcp');
    expect(recommended).toContain('database-inspector');
    expect(recommended).not.toContain('laravel-boost');
  });

  it('recommends the React defaults for standalone react stacks', () => {
    const recommended = names(
      manager.generate(fixtureProfile('react', ['next', 'tailwind'])).content,
    );

    expect(recommended).toEqual(
      expect.arrayContaining(['vite-inspector', 'react-router-mcp', 'tailwind-mcp']),
    );
    expect(recommended).not.toContain('database-inspector');
  });

  it('keeps the legacy path table for the cleanup', () => {
    expect(LEGACY_MCP_OUTPUT_PATHS['claude-code']).toBe('.claude/settings.mcp.json');
    expect(LEGACY_MCP_OUTPUT_PATHS.cursor).toBe('.cursor/mcp.json');
    expect(LEGACY_MCP_OUTPUT_PATHS.junie).toBe('.junie/mcp/mcp.json');
  });
});
