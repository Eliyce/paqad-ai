import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Resolver } from '@/resolver/resolver';
import { ContextDeduplicator } from '@/resolver/deduplicator';

describe('Resolver', () => {
  let runtimeRoot: string;

  beforeEach(() => {
    runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-runtime-'));
    seedFixtureRuntime(runtimeRoot);
  });

  afterEach(() => {
    rmSync(runtimeRoot, { recursive: true, force: true });
  });

  it('resolves coding:laravel with no capabilities', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: [],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'foundation.md',
    ]);
    expect(resolved.skills.map(artifactFileName)).toEqual(['shared-skill.md', 'shared-only.md']);
    expect(resolved.patterns.map(artifactFileName)).toEqual([
      'global-pattern.md',
      'coding-pattern.md',
      'shared-stack-pattern.md',
      'laravel-pattern.md',
    ]);
    expect(resolved.hooks.map(artifactFileName)).toEqual(['pre-commit-check.sh']);
  });

  it('resolves coding:laravel with ordered capabilities', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: ['inertia', 'react', 'boost'],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'foundation.md',
      'inertia.md',
      'react.md',
      'boost.md',
    ]);
    expect(resolved.mcpConfigs.map(artifactFileName)).toEqual([
      'global-mcp.yaml',
      'laravel-mcp.yaml',
      'boost-mcp.yaml',
    ]);
  });

  it('resolves coding:laravel with vue and tailwind capabilities', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: ['vue', 'tailwind'],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'foundation.md',
      'vue.md',
      'tailwind.md',
    ]);
    expect(resolved.rules.map(artifactFileName)).not.toContain('react.md');
    expect(resolved.rules.map(artifactFileName)).not.toContain('inertia.md');
  });

  it('resolves coding:flutter with no laravel capabilities', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'flutter',
      capabilities: [],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'flutter-foundation.md',
    ]);
    expect(resolved.rules.map(artifactFileName)).not.toContain('inertia.md');
    expect(resolved.rules.map(artifactFileName)).not.toContain('foundation.md');
  });

  it('resolves coding:react with standalone stack files', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'react',
      capabilities: ['next'],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'next.md',
      'react-foundation.md',
    ]);
    expect(resolved.mcpConfigs.map(artifactFileName)).toEqual([
      'global-mcp.yaml',
      'react-mcp.yaml',
    ]);
  });

  it('resolves coding:vue with standalone stack files', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'vue',
      capabilities: ['nuxt'],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'nuxt.md',
      'vue-foundation.md',
    ]);
    expect(resolved.mcpConfigs.map(artifactFileName)).toEqual(['global-mcp.yaml', 'vue-mcp.yaml']);
  });

  it('resolves content:short-video', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'content',
      stack: 'short-video',
      capabilities: [],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
    ]);
    expect(resolved.templates.map(artifactFileName)).toEqual(['global-template.hbs']);
  });

  it('uses most-specific-wins for same-named skills', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: [],
    });

    expect(resolved.skills.map(artifactFileName)).toEqual(['shared-skill.md', 'shared-only.md']);
    expect(
      resolved.skills.find((artifact) => artifactFileName(artifact) === 'shared-skill.md')?.source,
    ).toContain('stacks/laravel/skills/shared-skill.md');
  });

  it('additively merges patterns and MCP configs', async () => {
    const resolver = new Resolver({ runtimeRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: ['boost'],
    });

    expect(resolved.patterns.map(artifactFileName)).toEqual([
      'global-pattern.md',
      'coding-pattern.md',
      'shared-stack-pattern.md',
      'laravel-pattern.md',
    ]);
    expect(resolved.mcpConfigs.map(artifactFileName)).toEqual([
      'global-mcp.yaml',
      'laravel-mcp.yaml',
      'boost-mcp.yaml',
    ]);
  });

  it('returns empty arrays for missing directories', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-empty-runtime-'));
    const resolver = new Resolver({ runtimeRoot: emptyRoot });

    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: ['react'],
    });

    expect(Object.values(resolved)).toEqual([[], [], [], [], [], [], [], [], []]);

    rmSync(emptyRoot, { recursive: true, force: true });
  });

  it('applies deduplicator return value when deduplicator is provided', async () => {
    const resolver = new Resolver({ runtimeRoot });
    const deduplicator = new ContextDeduplicator();

    const deduplicate = vi.spyOn(deduplicator, 'deduplicate');

    const resolved = await resolver.resolve(
      { domain: 'coding', stack: 'laravel', capabilities: [] },
      deduplicator,
    );

    // Deduplicator was called for each artifact type
    expect(deduplicate).toHaveBeenCalled();

    // Rules should still be resolved (content is unique, so no deduplication removes items)
    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'foundation.md',
    ]);
  });

  it('uses deduplicated artifact order from deduplicator return value', async () => {
    const resolver = new Resolver({ runtimeRoot });
    const deduplicator = new ContextDeduplicator();

    // Spy on deduplicate and return a subset (simulating dedup removing one artifact)
    vi.spyOn(deduplicator, 'deduplicate').mockImplementation(async (_root, artifacts) => {
      // Return only the first artifact to simulate dedup collapsing the rest
      const kept = artifacts.slice(0, 1);
      return {
        artifacts: kept,
        references: new Map(),
        stats: {
          total_artifacts: artifacts.length,
          deduplicated: artifacts.length - 1,
          tokens_saved_estimate: 0,
        },
      };
    });

    const resolved = await resolver.resolve(
      { domain: 'coding', stack: 'laravel', capabilities: [] },
      deduplicator,
    );

    // Each artifact type should only have the first artifact kept
    expect(resolved.rules).toHaveLength(1);
    expect(resolved.skills).toHaveLength(1);
  });

  it('preserves ResolvedArtifact metadata (level, source) after deduplication', async () => {
    const resolver = new Resolver({ runtimeRoot });
    const deduplicator = new ContextDeduplicator();

    // Pass through all artifacts unchanged to verify metadata is preserved
    vi.spyOn(deduplicator, 'deduplicate').mockImplementation(async (_root, artifacts) => {
      return {
        artifacts,
        references: new Map(),
        stats: {
          total_artifacts: artifacts.length,
          deduplicated: 0,
          tokens_saved_estimate: 0,
        },
      };
    });

    const resolved = await resolver.resolve(
      { domain: 'coding', stack: 'laravel', capabilities: [] },
      deduplicator,
    );

    // ResolvedArtifact should have level and source from the original resolved array
    for (const rule of resolved.rules) {
      expect(rule).toHaveProperty('path');
      expect(rule).toHaveProperty('level');
      expect(rule).toHaveProperty('source');
    }
  });

  it('filters out artifacts whose path is not in the resolved set', async () => {
    const resolver = new Resolver({ runtimeRoot });
    const deduplicator = new ContextDeduplicator();

    // Return an artifact path that doesn't exist in the resolved set
    vi.spyOn(deduplicator, 'deduplicate').mockImplementation(async (_root, artifacts) => {
      const phantom = [{ path: '/nonexistent/phantom.md', type: 'rules' }];
      return {
        artifacts: [...artifacts, ...phantom],
        references: new Map(),
        stats: {
          total_artifacts: artifacts.length + 1,
          deduplicated: 0,
          tokens_saved_estimate: 0,
        },
      };
    });

    const resolved = await resolver.resolve(
      { domain: 'coding', stack: 'laravel', capabilities: [] },
      deduplicator,
    );

    // Phantom artifact should be filtered out; only real paths remain
    const rulePaths = resolved.rules.map((r) => r.path);
    expect(rulePaths).not.toContain('/nonexistent/phantom.md');
    expect(resolved.rules.length).toBeGreaterThan(0);
  });

  it('without deduplicator, assigns resolved array directly', async () => {
    const resolver = new Resolver({ runtimeRoot });

    // No deduplicator provided — should take the else branch
    const resolved = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: [],
    });

    expect(resolved.rules.map(artifactFileName)).toEqual([
      'constitution.md',
      'security.md',
      'content-rules.md',
      'architecture.md',
      'git.md',
      'foundation.md',
    ]);
  });
});

function seedFixtureRuntime(runtimeRoot: string): void {
  const fixtures: Record<string, string> = {
    'hooks/pre-commit-check.sh': '#!/usr/bin/env bash',
    'templates/global-template.hbs': '{{content}}',
    'base/rules/constitution.md': '# constitution',
    'base/rules/security.md': '# security',
    'base/skills/shared-skill.md': '# shared skill',
    'base/benchmarks/patterns/global-pattern.md': '# global pattern',
    'base/mcp/global-mcp.yaml': 'name: global',
    'capabilities/coding/rules/architecture.md': '# architecture',
    'capabilities/coding/skills/shared-skill.md': '# coding skill',
    'capabilities/coding/benchmarks/patterns/coding-pattern.md': '# coding pattern',
    'capabilities/coding/stacks/_shared/rules/git.md': '# git',
    'capabilities/coding/stacks/_shared/benchmarks/patterns/shared-stack-pattern.md':
      '# shared stack pattern',
    'capabilities/coding/stacks/laravel/rules/foundation.md': '# foundation',
    'capabilities/coding/stacks/laravel/skills/shared-skill.md': '# laravel skill',
    'capabilities/coding/stacks/laravel/skills/shared-only.md': '# laravel only',
    'capabilities/coding/stacks/laravel/benchmarks/patterns/laravel-pattern.md':
      '# laravel pattern',
    'capabilities/coding/stacks/laravel/mcp/laravel-mcp.yaml': 'name: laravel',
    'capabilities/coding/stacks/laravel/capabilities/inertia/rules/inertia.md': '# inertia',
    'capabilities/coding/stacks/laravel/capabilities/react/rules/react.md': '# react',
    'capabilities/coding/stacks/laravel/capabilities/vue/rules/vue.md': '# vue',
    'capabilities/coding/stacks/laravel/capabilities/tailwind/rules/tailwind.md': '# tailwind',
    'capabilities/coding/stacks/laravel/capabilities/boost/rules/boost.md': '# boost',
    'capabilities/coding/stacks/laravel/capabilities/boost/mcp/boost-mcp.yaml': 'name: boost',
    'capabilities/coding/stacks/flutter/rules/flutter-foundation.md': '# flutter foundation',
    'capabilities/coding/stacks/react/rules/react-foundation.md': '# react foundation',
    'capabilities/coding/stacks/react/mcp/react-mcp.yaml': 'name: react',
    'capabilities/coding/stacks/react/capabilities/next/rules/next.md': '# next',
    'capabilities/coding/stacks/vue/rules/vue-foundation.md': '# vue foundation',
    'capabilities/coding/stacks/vue/mcp/vue-mcp.yaml': 'name: vue',
    'capabilities/coding/stacks/vue/capabilities/nuxt/rules/nuxt.md': '# nuxt',
    'capabilities/content/rules/content-rules.md': '# content rules',
    'capabilities/content/stacks/short-video/rules/short-video-rules.md': '# short-video',
  };

  for (const [relativePath, content] of Object.entries(fixtures)) {
    const target = join(runtimeRoot, relativePath);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
}

function artifactFileName(artifact: { path: string }): string {
  return artifact.path.split('/').at(-1) ?? artifact.path;
}
