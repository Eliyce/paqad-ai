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

import { afterEach, describe, expect, it } from 'vitest';

import {
  PROJECT_AGENTS_DIR,
  isGeneratedProjectStageAgent,
  syncProjectStageAgents,
} from '@/onboarding/stage-agent-migration.js';
import { STAGE_AGENT_MARKER } from '@/stage-isolation/agent-writer.js';

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
    expect(syncProjectStageAgents(root)).toEqual({ written: [], kept: [] });
  });

  it('rewrites a stale paqad copy but keeps a hand-edited file and a folder in its place', () => {
    const root = project();
    const [stale, edited, folder] = syncProjectStageAgents(root).written;
    writeFileSync(join(root, stale), `${STAGE_AGENT_MARKER}\nold generated body\n`);
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
      expect(result.kept).toEqual([linked]);
      expect(result.written).toEqual([]);
      expect(readFileSync(outside, 'utf8')).toBe('outside\n');
      expect(readdirSync(agentsDir(root))).toContain(linked.split('/').pop());
    },
  );
});
