import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PROJECT_AGENTS_DIR,
  isGeneratedProjectStageAgent,
  syncProjectStageAgents,
} from '@/onboarding/stage-agent-migration.js';
import { STAGE_AGENT_MARKER, renderStageAgentFiles } from '@/stage-isolation/agent-writer.js';

const renames = vi.hoisted(() => ({ calls: [] as Array<[string, string, string]> }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      renames.calls.push([String(from), String(to), actual.readFileSync(from, 'utf8')]);
      actual.renameSync(from, to);
    },
  };
});

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-sync-'));
  roots.push(root);
  return root;
}

function agentsDir(root: string): string {
  return join(root, PROJECT_AGENTS_DIR);
}

describe('syncProjectStageAgents', () => {
  it('writes every generated stage agent into a project that has none, then is a no-op', () => {
    const root = project();
    const first = syncProjectStageAgents(root);
    expect(first.written.length).toBeGreaterThan(0);
    expect(first.kept).toEqual([]);
    for (const rel of first.written) {
      const path = join(root, rel);
      expect(isGeneratedProjectStageAgent(path, readFileSync(path, 'utf8'))).toBe(true);
    }
    expect(syncProjectStageAgents(root)).toEqual({ written: [], kept: [], symlinks: [] });
  });

  it('rewrites a stale paqad copy but keeps a hand-edited file and a folder in its place', () => {
    const root = project();
    const [stale, edited, folder] = syncProjectStageAgents(root).written;
    const name = stale!.split('/').pop();
    const render = renderStageAgentFiles('claude-code').find((agent) => agent.name === name)!;
    writeFileSync(join(root, stale!), render.content);
    writeFileSync(join(root, edited), 'my own agent\n');
    rmSync(join(root, folder));
    mkdirSync(join(root, folder));
    const result = syncProjectStageAgents(root);
    expect(result.written).toEqual([stale]);
    expect(result.kept.sort()).toEqual([edited, folder].sort());
    expect(readFileSync(join(root, edited), 'utf8')).toBe('my own agent\n');
  });

  it.skipIf(process.platform === 'win32')(
    'keeps a symlink at an agent path and never writes through it',
    () => {
      const root = project();
      const [linked] = syncProjectStageAgents(root).written;
      const outside = join(project(), 'outside.md');
      writeFileSync(outside, 'outside\n');
      rmSync(join(root, linked));
      symlinkSync(outside, join(root, linked));
      const result = syncProjectStageAgents(root);
      expect(result.symlinks).toEqual([linked]);
      expect(result.kept).toEqual([]);
      expect(result.written).toEqual([]);
      expect(readFileSync(outside, 'utf8')).toBe('outside\n');
      expect(readdirSync(agentsDir(root))).toContain(linked.split('/').pop());
    },
  );
});

describe('who owns a project paqad-*.md (FR-9, FR-14)', () => {
  it('AC-6: keeps a marked paqad-planning.md whose body was edited, byte for byte', () => {
    const root = project();
    syncProjectStageAgents(root);
    const path = join(agentsDir(root), 'paqad-planning.md');
    const edited = `${readFileSync(path, 'utf8')}\nOur own extra rule.\n`;
    writeFileSync(path, edited);
    expect(edited).toContain(STAGE_AGENT_MARKER);
    const result = syncProjectStageAgents(root);
    expect(result.kept).toContain('.claude/agents/paqad-planning.md');
    expect(readFileSync(path, 'utf8')).toBe(edited);
  });

  it('AC-7: names a team paqad-ours.md that paqad did not write and never touches it', () => {
    const root = project();
    mkdirSync(agentsDir(root), { recursive: true });
    writeFileSync(join(agentsDir(root), 'paqad-ours.md'), 'ours\n');
    const result = syncProjectStageAgents(root);
    expect(result.kept).toEqual(['.claude/agents/paqad-ours.md']);
    expect(readFileSync(join(agentsDir(root), 'paqad-ours.md'), 'utf8')).toBe('ours\n');
  });

  it('AC-46: writes each agent to a temp file and renames it into place', () => {
    const root = project();
    renames.calls.length = 0;
    const { written } = syncProjectStageAgents(root);
    expect(renames.calls).toHaveLength(written.length);
    for (const [from, to, content] of renames.calls) {
      expect(from).toMatch(/\.tmp$/u);
      expect(to.endsWith('.md')).toBe(true);
      expect(content).toBe(readFileSync(to, 'utf8'));
    }
    expect(readdirSync(agentsDir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
