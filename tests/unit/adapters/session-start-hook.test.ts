import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { CodexCliAdapter } from '@/adapters/codex/codex-adapter.js';
import { AntigravityAdapter } from '@/adapters/antigravity/antigravity-adapter.js';
import { GeminiCliAdapter } from '@/adapters/gemini/gemini-adapter.js';
import { JunieAdapter } from '@/adapters/junie/junie-adapter.js';
import { AdapterFactory } from '@/adapters/index.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import {
  buildDecisionPauseContractSection,
  extractDecisionPauseContractSection,
  normalizeProviderEntryContract,
} from '@/adapters/shared/provider-entry-contract.js';

const CONFIG_CONTEXT = {
  frameworkPath: '.paqad/framework-path.txt',
  rulesPath: 'docs/instructions/rules',
  projectRoot: '/tmp/project',
};

describe('Generated agent entry files', () => {
  it('do not mention the silent update hook in CLAUDE.md', async () => {
    const adapter = new ClaudeCodeAdapter();
    const files = await adapter.generateConfig(CONFIG_CONTEXT);
    const claudeMd = files.find((f) => f.path === 'CLAUDE.md');
    expect(claudeMd?.content).not.toContain('silent-update.sh');
    expect(claudeMd?.content).not.toContain('.paqad/hooks/');
  });

  it('do not mention the silent update hook in AGENTS.md', async () => {
    const adapter = new CodexCliAdapter();
    const files = await adapter.generateConfig(CONFIG_CONTEXT);
    const agentsMd = files.find((f) => f.path === 'AGENTS.md');
    expect(agentsMd?.content).not.toContain('silent-update.sh');
    expect(agentsMd?.content).not.toContain('.paqad/hooks/');
  });

  it('do not mention the silent update hook in ANTIGRAVITY.md', async () => {
    const adapter = new AntigravityAdapter();
    const files = await adapter.generateConfig(CONFIG_CONTEXT);
    const antigravityMd = files.find((f) => f.path === 'ANTIGRAVITY.md');
    expect(antigravityMd?.content).not.toContain('silent-update.sh');
    expect(antigravityMd?.content).not.toContain('.paqad/hooks/');
  });

  it('do not mention the silent update hook in GEMINI.md', async () => {
    const adapter = new GeminiCliAdapter();
    const files = await adapter.generateConfig(CONFIG_CONTEXT);
    const geminiMd = files.find((f) => f.path === 'GEMINI.md');
    expect(geminiMd?.content).not.toContain('silent-update.sh');
    expect(geminiMd?.content).not.toContain('.paqad/hooks/');
  });

  it('do not mention the silent update hook in .junie/AGENTS.md', async () => {
    const adapter = new JunieAdapter();
    const files = await adapter.generateConfig(CONFIG_CONTEXT);
    const junieMd = files.find((f) => f.path === '.junie/AGENTS.md');
    expect(junieMd?.content).not.toContain('silent-update.sh');
    expect(junieMd?.content).not.toContain('.paqad/hooks/');
  });

  it('keeps adapter entry files free of session-start hook prose', async () => {
    const adapters = [
      new ClaudeCodeAdapter(),
      new CodexCliAdapter(),
      new AntigravityAdapter(),
      new GeminiCliAdapter(),
      new JunieAdapter(),
    ];

    for (const adapter of adapters) {
      const files = await adapter.generateConfig(CONFIG_CONTEXT);
      for (const file of files) {
        expect(file.content).not.toMatch(/session start/i);
        expect(file.content).not.toMatch(/do not wait for it to complete/i);
        expect(file.content).not.toMatch(/do not show its output to the user/i);
      }
    }
  });

  it('includes the canonical decision pause contract in every generated provider entry file', async () => {
    const expected = normalizeProviderEntryContract(buildDecisionPauseContractSection());

    for (const adapterType of ADAPTER_TYPES) {
      const adapter = AdapterFactory.create(adapterType);
      const [file] = await adapter.generateConfig(CONFIG_CONTEXT);
      const section = extractDecisionPauseContractSection(file?.content ?? '');

      expect(section).not.toBeNull();
      expect(normalizeProviderEntryContract(section!)).toBe(expected);
    }
  });

  it('returns null when a provider entry file has no decision pause contract section', () => {
    expect(extractDecisionPauseContractSection('# Heading\n\nNo contract here')).toBeNull();
  });

  it('extracts the decision pause contract even when the section reaches end-of-file', () => {
    const content = `${buildDecisionPauseContractSection()}\n`;

    expect(extractDecisionPauseContractSection(content)).toBe(buildDecisionPauseContractSection());
  });
});
