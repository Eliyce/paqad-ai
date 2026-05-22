import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AntigravityAdapter,
  ClaudeCodeAdapter,
  CodexCliAdapter,
  GeminiCliAdapter,
  JunieAdapter,
} from '@/adapters';

import { fixtureArtifact, fixtureProfile } from './shared.fixture';

describe('adapter helper methods', () => {
  it('covers agents, caching, and memory outputs across adapters', async () => {
    const adapters = [
      new ClaudeCodeAdapter(),
      new CodexCliAdapter(),
      new AntigravityAdapter(),
      new GeminiCliAdapter(),
    ];

    for (const adapter of adapters) {
      const agents = await adapter.generateAgents([fixtureArtifact('sample-agent.md')]);
      const caching = await adapter.configureCaching(fixtureProfile());
      const memory = await adapter.configureMemory(fixtureProfile());

      expect(agents[0]?.content).toContain('Sample Agent');
      expect(caching[0]?.content).toContain('"enabled": true');
      expect(memory[0]?.content).toContain('"mcp_first": true');
    }
  });

  it('exposes reduced capabilities for Junie', () => {
    const adapter = new JunieAdapter();

    expect(adapter.capabilities).toEqual({
      skills: false,
      agents: false,
      hooks: false,
      mcp: true,
      caching: false,
      memory: false,
    });
  });

  it('exposes adapter-declared config and MCP output paths', () => {
    const adapter = new CodexCliAdapter();

    expect(adapter.getConfigPath()).toBe('AGENTS.md');
    expect(adapter.getMcpPath()).toBe('.codex/mcp.json');
  });

  it('preserves skill bundle paths from source and path-based skills roots', async () => {
    const adapter = new CodexCliAdapter();
    const tempRoot = mkdtempSync(join(tmpdir(), 'paqad-adapter-skills-'));
    const pathDerivedFile = join(tempRoot, 'nested', 'skills', 'ui', 'checklist.md');
    const basenameFallbackFile = join(tempRoot, 'misc', 'plain.md');

    try {
      mkdirSync(join(tempRoot, 'nested', 'skills', 'ui'), { recursive: true });
      mkdirSync(join(tempRoot, 'misc'), { recursive: true });
      writeFileSync(pathDerivedFile, 'path-derived');
      writeFileSync(basenameFallbackFile, 'basename-fallback');

      const files = await adapter.generateSkills([
        {
          level: 1,
          source: 'team/skills/ui/SKILL.md',
          path: join(process.cwd(), 'tests/unit/adapters/fixtures/sample-skill/SKILL.md'),
        },
        {
          level: 1,
          source: 'checklist.md',
          path: pathDerivedFile,
        },
        {
          level: 1,
          source: 'plain.md',
          path: basenameFallbackFile,
        },
      ]);

      expect(files.map((file) => file.path)).toEqual([
        '.codex/skills/ui/SKILL.md',
        '.codex/skills/ui/checklist.md',
        '.codex/skills/plain.md',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
