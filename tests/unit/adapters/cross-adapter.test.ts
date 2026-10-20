import { AdapterFactory } from '@/adapters';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { fixtureProfile } from './shared.fixture.js';

describe('cross-adapter consistency', () => {
  it('keeps capability-aware outputs consistent across adapters', async () => {
    const adapters = ADAPTER_TYPES.map((type) => AdapterFactory.create(type));
    const profile = fixtureProfile();

    const outputs = await Promise.all(
      adapters.map(async (adapter) => [
        ...(await adapter.generateConfig({
          frameworkPath: '.paqad/framework-path.txt',
          rulesPath: 'docs/rules',
          projectRoot: '/tmp/project',
        })),
        ...(adapter.capabilities.caching ? await adapter.configureCaching(profile) : []),
        ...(adapter.capabilities.memory ? await adapter.configureMemory(profile) : []),
        ...(adapter.capabilities.mcp ? await adapter.installMcp([], profile) : []),
      ]),
    );

    expect(outputs).toHaveLength(ADAPTER_TYPES.length);

    for (const [index, adapter] of adapters.entries()) {
      const files = outputs[index] ?? [];
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]?.content).toContain('.paqad/framework-path.txt');
      expect(files[0]?.content).toContain('AGENT-BOOTSTRAP.md');
      expect(files.some((file) => file.path.includes('mcp'))).toBe(false);
      expect(files.some((file) => file.path.includes('cache'))).toBe(adapter.capabilities.caching);
      expect(files.some((file) => file.path.includes('memory'))).toBe(adapter.capabilities.memory);
    }
  });

  it('renders an identical lean entry-file stub across every adapter', async () => {
    const adapters = ADAPTER_TYPES.map((type) => AdapterFactory.create(type));

    const entries = await Promise.all(
      adapters.map(async (adapter) => {
        const [file] = await adapter.generateConfig({
          frameworkPath: '.paqad/framework-path.txt',
          rulesPath: 'docs/rules',
          projectRoot: '/tmp/project',
        });
        return file?.content ?? '';
      }),
    );

    for (const [index, content] of entries.entries()) {
      const type = ADAPTER_TYPES[index];

      expect(content, type).toContain('.paqad/framework-path.txt');
      expect(content, type).toContain('AGENT-BOOTSTRAP.md');
      expect(content, type).toContain('proceed as a normal assistant');
      expect(content, type).toContain('Adapter:');
      expect(content, type).toContain(type);

      expect(content, type).not.toContain('docs/instructions');
      expect(content, type).not.toContain('create documentation');
      expect(content, type).not.toContain(
        'Do not ask the user to choose a document type when a Paqad workflow already matches the request.',
      );
      expect(content, type).not.toContain('## Decision Pause Contract');
      expect(content, type).not.toContain('## paqad in your chat');

      expect(content.includes('\n## '), type).toBe(false);
    }
  });
});
