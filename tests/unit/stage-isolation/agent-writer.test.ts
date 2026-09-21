import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeStageAgents } from '@/stage-isolation/agent-writer';

const roots: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const ON = { PAQAD_STAGE_ISOLATION: 'on' } as NodeJS.ProcessEnv;

describe('writeStageAgents (issue #567)', () => {
  it('writes nothing when stage isolation is off (default)', () => {
    const project = tempDir('paqad-sa-project-');
    const home = tempDir('paqad-sa-home-');
    const written = writeStageAgents(project, { homeDir: home, env: {} });
    expect(written).toEqual([]);
    expect(existsSync(join(home, '.claude/agents'))).toBe(false);
    expect(existsSync(join(home, '.codex/agents'))).toBe(false);
  });

  it('writes six agents per host at user scope when the flag is on', () => {
    const project = tempDir('paqad-sa-project-');
    const home = tempDir('paqad-sa-home-');
    const written = writeStageAgents(project, { homeDir: home, env: ON });

    expect(written).toHaveLength(12);
    const claudeDir = join(home, '.claude/agents');
    const codexDir = join(home, '.codex/agents');
    expect(readdirSync(claudeDir).sort()).toEqual([
      'paqad-checks.md',
      'paqad-development.md',
      'paqad-documentation-sync.md',
      'paqad-planning.md',
      'paqad-review.md',
      'paqad-specification.md',
    ]);
    expect(readdirSync(codexDir).sort()).toEqual([
      'paqad-checks.toml',
      'paqad-development.toml',
      'paqad-documentation-sync.toml',
      'paqad-planning.toml',
      'paqad-review.toml',
      'paqad-specification.toml',
    ]);
  });

  it('renders host-correct content: Claude frontmatter, Codex TOML', () => {
    const project = tempDir('paqad-sa-project-');
    const home = tempDir('paqad-sa-home-');
    writeStageAgents(project, { homeDir: home, env: ON });

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

  it('a second run is byte-identical (AC-1)', () => {
    const project = tempDir('paqad-sa-project-');
    const home = tempDir('paqad-sa-home-');
    writeStageAgents(project, { homeDir: home, env: ON });
    const first = readFileSync(join(home, '.claude/agents/paqad-planning.md'), 'utf8');
    writeStageAgents(project, { homeDir: home, env: ON });
    const second = readFileSync(join(home, '.claude/agents/paqad-planning.md'), 'utf8');
    expect(second).toBe(first);
  });

  it('never writes into the project directory (INV-3)', () => {
    const project = tempDir('paqad-sa-project-');
    const home = tempDir('paqad-sa-home-');
    writeStageAgents(project, { homeDir: home, env: ON });
    expect(existsSync(join(project, '.claude'))).toBe(false);
    expect(existsSync(join(project, '.codex'))).toBe(false);
  });
});
