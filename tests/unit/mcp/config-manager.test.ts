import { describe, expect, it } from 'vitest';

import { McpConfigManager } from '@/mcp/config-manager.js';

import { fixtureProfile } from './shared.fixture.js';

describe('McpConfigManager', () => {
  const manager = new McpConfigManager();

  it('generates Laravel Boost config for coding laravel boost', () => {
    const file = manager.generate(fixtureProfile('laravel'), 'claude-code');
    const parsed = JSON.parse(file.content) as { mcpServers: Record<string, unknown> };

    expect(file.path).toBe('.claude/settings.mcp.json');
    expect(parsed.mcpServers).toHaveProperty('laravel-boost');
    expect(parsed.mcpServers).toHaveProperty('database-inspector');
  });

  it('omits default MCP servers that the profile explicitly disables', () => {
    const file = manager.generate(fixtureProfile('laravel'), 'claude-code');
    const parsed = JSON.parse(file.content) as { mcpServers: Record<string, unknown> };

    expect(parsed.mcpServers).not.toHaveProperty('figma');
  });

  it('includes explicitly enabled non-default MCP servers in generated config', () => {
    const profile = fixtureProfile('laravel');
    profile.mcp.servers = [
      { name: 'figma', enabled: false, config: {} },
      { name: 'react-router-mcp', enabled: true, config: { mode: 'manual' } },
    ];

    const file = manager.generate(profile, 'claude-code');
    const parsed = JSON.parse(file.content) as {
      mcpServers: Record<string, { enabled: boolean; mode?: string }>;
    };

    expect(parsed.mcpServers).toHaveProperty('react-router-mcp');
    expect(parsed.mcpServers['react-router-mcp']).toMatchObject({
      enabled: true,
      mode: 'manual',
    });
  });

  it('generates Dart MCP config for coding flutter', () => {
    const file = manager.generate(fixtureProfile('flutter'), 'codex-cli');
    const parsed = JSON.parse(file.content) as { mcpServers: Record<string, unknown> };

    expect(file.path).toBe('.codex/mcp.json');
    expect(parsed.mcpServers).toHaveProperty('dart-mcp');
    expect(parsed.mcpServers).toHaveProperty('database-inspector');
  });

  it('writes Antigravity MCP config to the Antigravity path', () => {
    const file = manager.generate(fixtureProfile('laravel'), 'antigravity');
    const parsed = JSON.parse(file.content) as { mcpServers: Record<string, unknown> };

    expect(file.path).toBe('.antigravity/mcp.json');
    expect(parsed.mcpServers).toHaveProperty('laravel-boost');
    expect(parsed.mcpServers).toHaveProperty('database-inspector');
  });

  it('generates DB Inspector for all coding stacks', () => {
    const laravel = JSON.parse(
      manager.generate(fixtureProfile('laravel'), 'gemini-cli').content,
    ) as {
      mcpServers: Record<string, unknown>;
    };
    const flutter = JSON.parse(
      manager.generate(fixtureProfile('flutter'), 'gemini-cli').content,
    ) as {
      mcpServers: Record<string, unknown>;
    };

    expect(laravel.mcpServers).toHaveProperty('database-inspector');
    expect(flutter.mcpServers).toHaveProperty('database-inspector');
  });

  it('does not generate Laravel Boost for flutter', () => {
    const parsed = JSON.parse(
      manager.generate(fixtureProfile('flutter'), 'claude-code').content,
    ) as {
      mcpServers: Record<string, unknown>;
    };

    expect(parsed.mcpServers).not.toHaveProperty('laravel-boost');
  });

  it('config format matches agent expectations', () => {
    const parsed = JSON.parse(
      manager.generate(fixtureProfile('laravel'), 'gemini-cli').content,
    ) as {
      mcpServers: Record<string, unknown>;
    };

    expect(parsed).toHaveProperty('mcpServers');
    expect(parsed.mcpServers['laravel-boost']).toMatchObject({
      enabled: true,
      stack: 'laravel',
    });
  });

  it('writes Junie MCP config to the project-level Junie path', () => {
    const file = manager.generate(fixtureProfile('laravel'), 'junie');
    const parsed = JSON.parse(file.content) as { mcpServers: Record<string, unknown> };

    expect(file.path).toBe('.junie/mcp/mcp.json');
    expect(parsed.mcpServers).toHaveProperty('laravel-boost');
    expect(parsed.mcpServers).toHaveProperty('database-inspector');
  });

  it('generates React MCP defaults for standalone react stacks', () => {
    const file = manager.generate(fixtureProfile('react', ['next', 'tailwind']), 'claude-code');
    const parsed = JSON.parse(file.content) as { mcpServers: Record<string, unknown> };

    expect(parsed.mcpServers).toHaveProperty('vite-inspector');
    expect(parsed.mcpServers).toHaveProperty('react-router-mcp');
    expect(parsed.mcpServers).toHaveProperty('tailwind-mcp');
    expect(parsed.mcpServers).not.toHaveProperty('database-inspector');
  });
});
