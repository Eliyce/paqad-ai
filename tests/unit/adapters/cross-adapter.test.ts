import { AdapterFactory } from '@/adapters';
import {
  buildDecisionPauseContractSection,
  decisionPauseContractPointerBody,
  extractDecisionPauseContractSection,
  normalizeProviderEntryContract,
} from '@/adapters/shared/provider-entry-contract.js';
import { fixtureProfile } from './shared.fixture.js';

describe('cross-adapter consistency', () => {
  it('keeps capability-aware outputs consistent across adapters', async () => {
    const adapters = [
      'claude-code',
      'codex-cli',
      'antigravity',
      'gemini-cli',
      'junie',
      'cursor',
      'github-copilot',
      'windsurf',
      'continue',
      'aider',
    ].map((type) => AdapterFactory.create(type as 'claude-code' | 'junie'));
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

    expect(outputs).toHaveLength(10);

    for (const [index, adapter] of adapters.entries()) {
      const files = outputs[index] ?? [];
      // Config file is always present as the first file
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]?.content).toContain('.paqad/framework-path.txt');
      expect(files[0]?.content).toContain('create documentation');
      expect(files[0]?.content).toContain(
        'Do not ask the user to choose a document type when a Paqad workflow already matches the request.',
      );
      expect(files.some((file) => file.path.includes('mcp'))).toBe(adapter.capabilities.mcp);
      expect(files.some((file) => file.path.includes('cache'))).toBe(adapter.capabilities.caching);
      expect(files.some((file) => file.path.includes('memory'))).toBe(adapter.capabilities.memory);
    }
  });

  it('shares an identical pointer body across adapters while keeping per-adapter UI notes', async () => {
    const types = [
      'claude-code',
      'codex-cli',
      'antigravity',
      'gemini-cli',
      'junie',
      'cursor',
      'github-copilot',
      'windsurf',
      'continue',
      'aider',
    ] as const;
    const adapters = types.map((type) => AdapterFactory.create(type));
    const pointerBody = decisionPauseContractPointerBody();

    const sections = await Promise.all(
      adapters.map(async (adapter) => {
        const [file] = await adapter.generateConfig({
          frameworkPath: '.paqad/framework-path.txt',
          rulesPath: 'docs/rules',
          projectRoot: '/tmp/project',
        });
        return extractDecisionPauseContractSection(file?.content ?? '');
      }),
    );

    // Each section must:
    //   1. be present,
    //   2. contain the shared pointer body verbatim,
    //   3. match its adapter-specific rendering (UI note differs per adapter).
    for (const [index, section] of sections.entries()) {
      expect(section).not.toBeNull();
      expect(section!).toContain(pointerBody);
      expect(normalizeProviderEntryContract(section!)).toBe(
        normalizeProviderEntryContract(buildDecisionPauseContractSection(types[index])),
      );
    }
  });
});
