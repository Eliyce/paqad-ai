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
      // Config file is always present as the first file.
      expect(files.length).toBeGreaterThan(0);
      // Issue #229 — the entry file is now a lean stub pointing at the framework
      // bootstrap, not a copy of the load order or the contracts.
      expect(files[0]?.content).toContain('.paqad/framework-path.txt');
      expect(files[0]?.content).toContain('AGENT-BOOTSTRAP.md');
      expect(files.some((file) => file.path.includes('mcp'))).toBe(adapter.capabilities.mcp);
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

      // The lean stub carries exactly three things across every host:
      //   1. a one-line bootstrap pointer (framework-path + AGENT-BOOTSTRAP.md),
      //   2. the graceful-degradation fallback clause,
      //   3. the `Adapter:` footer naming this adapter.
      expect(content, type).toContain('.paqad/framework-path.txt');
      expect(content, type).toContain('AGENT-BOOTSTRAP.md');
      expect(content, type).toContain('proceed as a normal assistant');
      expect(content, type).toContain('Adapter:');
      expect(content, type).toContain(type);

      // It NO LONGER inlines the load order, the workflow-handling prose, or
      // either contract — those now live only in the framework bootstrap behind
      // its enablement check.
      expect(content, type).not.toContain('docs/instructions');
      expect(content, type).not.toContain('create documentation');
      expect(content, type).not.toContain(
        'Do not ask the user to choose a document type when a Paqad workflow already matches the request.',
      );
      expect(content, type).not.toContain('## Decision Pause Contract');
      expect(content, type).not.toContain('## paqad in your chat');

      // A lean stub has zero second-level headings.
      expect(content.includes('\n## '), type).toBe(false);
    }
  });
});
