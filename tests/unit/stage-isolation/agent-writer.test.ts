import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveStageAgentSettings } from '@/core/framework-config';
import {
  renderClaudePluginStageAgents,
  renderStageAgentFiles,
  writeStageAgents,
} from '@/stage-isolation/agent-writer';

const roots: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('writeStageAgents', () => {
  it('writes six stage agents and two High Table agents per host at user scope (no config knob, AC-46)', () => {
    const home = tempDir('paqad-sa-home-');
    const written = writeStageAgents({ homeDir: home });

    expect(written).toHaveLength(16);
    const claudeDir = join(home, '.claude/agents');
    const codexDir = join(home, '.codex/agents');
    expect(readdirSync(claudeDir).sort()).toEqual([
      'paqad-checks.md',
      'paqad-chief-architect.md',
      'paqad-development.md',
      'paqad-documentation-sync.md',
      'paqad-expert.md',
      'paqad-planning.md',
      'paqad-review.md',
      'paqad-specification.md',
    ]);
    expect(readdirSync(codexDir).sort()).toEqual([
      'paqad-checks.toml',
      'paqad-chief-architect.toml',
      'paqad-development.toml',
      'paqad-documentation-sync.toml',
      'paqad-expert.toml',
      'paqad-planning.toml',
      'paqad-review.toml',
      'paqad-specification.toml',
    ]);
  });

  it('renders host-correct content: Claude frontmatter, Codex TOML', () => {
    const home = tempDir('paqad-sa-home-');
    writeStageAgents({ homeDir: home });

    const claude = readFileSync(join(home, '.claude/agents/paqad-development.md'), 'utf8');
    expect(claude).toMatch(/^---\n/);
    expect(claude).toContain('name: paqad-development');
    expect(claude).toContain('model: inherit');
    expect(claude).toContain('tools: Read, Edit, Write');

    const codex = readFileSync(join(home, '.codex/agents/paqad-development.toml'), 'utf8');
    expect(codex).toContain('name = "paqad-development"');
    expect(codex).toContain('developer_instructions = """');
    expect(codex).toContain('SE_SESSION');
  });

  it('a second run is byte-identical (deterministic output)', () => {
    const home = tempDir('paqad-sa-home-');
    writeStageAgents({ homeDir: home });
    const first = readFileSync(join(home, '.claude/agents/paqad-planning.md'), 'utf8');
    writeStageAgents({ homeDir: home });
    const second = readFileSync(join(home, '.claude/agents/paqad-planning.md'), 'utf8');
    expect(second).toBe(first);
  });

  it('never writes into any project directory (INV-2)', () => {
    const project = tempDir('paqad-sa-project-');
    const home = tempDir('paqad-sa-home-');
    writeStageAgents({ homeDir: home });
    expect(existsSync(join(project, '.claude'))).toBe(false);
    expect(existsSync(join(project, '.codex'))).toBe(false);
  });
});

function frontmatter(content: string): Record<string, string> {
  const block = content.split('---\n')[1] ?? '';
  return Object.fromEntries(
    block
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]),
  );
}

describe('stage agent frontmatter', () => {
  const EFFORT: Record<string, string | undefined> = {
    'paqad-planning.md': 'high',
    'paqad-specification.md': 'high',
    'paqad-development.md': undefined,
    'paqad-review.md': 'high',
    'paqad-checks.md': 'low',
    'paqad-documentation-sync.md': 'low',
  };

  it('carries the default effort, model inherit and omitClaudeMd on every claude-code stage agent', () => {
    const files = new Map(renderClaudePluginStageAgents().map((file) => [file.name, file.content]));
    for (const [name, effort] of Object.entries(EFFORT)) {
      const meta = frontmatter(files.get(name)!);
      expect(meta.model).toBe('inherit');
      expect(meta.effort).toBe(effort);
      expect(meta.omitClaudeMd).toBe('true');
    }
    for (const name of ['paqad-expert.md', 'paqad-chief-architect.md']) {
      const meta = frontmatter(files.get(name)!);
      expect(meta.model).toBe('inherit');
      expect(meta.effort).toBeUndefined();
      expect(meta.omitClaudeMd).toBeUndefined();
    }
  });

  it('keeps the defaults in the agent files whatever the project config says', () => {
    const before = process.env.PAQAD_STAGE_EFFORT_CHECKS;
    process.env.PAQAD_STAGE_EFFORT_CHECKS = 'high';
    try {
      const home = tempDir('paqad-sa-home-');
      writeStageAgents({ homeDir: home });
      const checks = readFileSync(join(home, '.claude/agents/paqad-checks.md'), 'utf8');
      expect(frontmatter(checks).effort).toBe('low');
    } finally {
      if (before === undefined) delete process.env.PAQAD_STAGE_EFFORT_CHECKS;
      else process.env.PAQAD_STAGE_EFFORT_CHECKS = before;
    }
  });

  it('renders no effort line when every stage is set to inherit', () => {
    const settings = Object.fromEntries(
      Object.keys(resolveStageAgentSettings()).map((stage) => [
        stage,
        { effort: 'inherit' as const, model: 'inherit' as const },
      ]),
    );
    for (const file of renderStageAgentFiles('claude-code', settings)) {
      expect(file.content).not.toMatch(/^effort:/m);
      expect(frontmatter(file.content).model).toBe('inherit');
    }
  });

  it('renders the chosen model and effort when given settings', () => {
    const settings = {
      ...resolveStageAgentSettings(),
      checks: { effort: 'medium' as const, model: 'haiku' as const },
    };
    const checks = renderStageAgentFiles('claude-code', settings).find(
      (file) => file.name === 'paqad-checks.md',
    )!;
    expect(frontmatter(checks.content)).toMatchObject({ model: 'haiku', effort: 'medium' });
  });

  it('codex-cli files carry no effort, model or omitClaudeMd keys', () => {
    for (const file of renderStageAgentFiles('codex-cli')) {
      expect(file.content).not.toMatch(/^(effort|model|omitClaudeMd)\b/m);
    }
  });

  it('throws for a host with no stage agents', () => {
    expect(() => renderStageAgentFiles('gemini-cli')).toThrow(/no stage-agent host/);
  });
});
