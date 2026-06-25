import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { CodexCliAdapter } from '@/adapters/codex/codex-adapter.js';
import { AntigravityAdapter } from '@/adapters/antigravity/antigravity-adapter.js';
import { GeminiCliAdapter } from '@/adapters/gemini/gemini-adapter.js';
import { JunieAdapter } from '@/adapters/junie/junie-adapter.js';
import { AdapterFactory } from '@/adapters/index.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

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

  it('keeps rendered markdown entry files free of hook script references', async () => {
    for (const adapterType of ADAPTER_TYPES) {
      const adapter = AdapterFactory.create(adapterType);
      // The markdown entry file is the first generated file for every adapter;
      // later files (e.g. .claude/settings.json) legitimately wire the live
      // session-start hooks and are not entry-file prose.
      const [entry] = await adapter.generateConfig(CONFIG_CONTEXT);
      const content = entry?.content ?? '';
      expect(content).not.toContain('silent-update.sh');
      expect(content).not.toContain('silent-update.mjs');
      expect(content).not.toContain('.paqad/hooks/');
      expect(content).not.toContain('verification-record');
    }
  });

  it('renders every provider entry file as a lean bootstrap stub', async () => {
    for (const adapterType of ADAPTER_TYPES) {
      const adapter = AdapterFactory.create(adapterType);
      const [entry] = await adapter.generateConfig(CONFIG_CONTEXT);
      const content = entry?.content ?? '';

      // The lean stub points at the framework bootstrap instead of inlining the
      // load order, workflow prose, or either managed contract.
      expect(content).toContain('.paqad/framework-path.txt');
      expect(content).toContain('AGENT-BOOTSTRAP.md');

      // Bootstrap prose, workflow prose, and both contracts now live in
      // AGENT-BOOTSTRAP.md, never in the entry file itself.
      expect(content).not.toContain('docs/instructions');
      expect(content).not.toContain('docs/modules');
      expect(content).not.toContain('create documentation');
      expect(content).not.toContain('Do not ask the user to choose a document type');
      expect(content).not.toContain('## paqad in your chat');
      expect(content).not.toContain('## Decision Pause Contract');
      expect(content).not.toContain('Decision Pause Contract');

      // A lean stub has no `## ` headings at all.
      expect(content).not.toMatch(/^## /m);
    }
  });
});
