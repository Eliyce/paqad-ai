import { join } from 'node:path';

import { Resolver } from '@/resolver/index.js';

describe('resolver output matrix', () => {
  const runtimeRoot = join(process.cwd(), 'runtime');
  const resolver = new Resolver({ runtimeRoot });

  it('resolves all critical artifact groups for laravel', async () => {
    const result = await resolver.resolve({
      domain: 'coding',
      stack: 'laravel',
      capabilities: ['boost'],
    });

    expect(result.rules.length).toBeGreaterThan(0);
    expect(result.skills.length).toBeGreaterThan(0);
    expect(result.agents.length).toBeGreaterThan(0);
    expect(result.hooks.length).toBeGreaterThan(0);
    expect(result.checklists.length).toBeGreaterThan(0);
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.mcpConfigs.length).toBeGreaterThan(0);
  });

  it('resolves all critical artifact groups for flutter, react, vue, and content', async () => {
    const flutter = await resolver.resolve({
      domain: 'coding',
      stack: 'flutter',
      capabilities: [],
    });
    const react = await resolver.resolve({
      domain: 'coding',
      stack: 'react',
      capabilities: ['next'],
    });
    const vue = await resolver.resolve({
      domain: 'coding',
      stack: 'vue',
      capabilities: ['nuxt'],
    });
    const content = await resolver.resolve({
      domain: 'content',
      stack: 'short-video',
      capabilities: [],
    });

    expect(flutter.rules.length).toBeGreaterThan(0);
    expect(flutter.skills.length).toBeGreaterThan(0);
    expect(flutter.agents.length).toBeGreaterThan(0);
    expect(flutter.mcpConfigs.length).toBeGreaterThan(0);
    expect(react.rules.length).toBeGreaterThan(0);
    expect(react.skills.length).toBeGreaterThan(0);
    expect(react.agents.length).toBeGreaterThan(0);
    expect(vue.rules.length).toBeGreaterThan(0);
    expect(vue.skills.length).toBeGreaterThan(0);
    expect(vue.agents.length).toBeGreaterThan(0);
    expect(content.rules.length).toBeGreaterThan(0);
    expect(content.skills.length).toBeGreaterThan(0);
    expect(content.agents.length).toBeGreaterThan(0);
  });
});
