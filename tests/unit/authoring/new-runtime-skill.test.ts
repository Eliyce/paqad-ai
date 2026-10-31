import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { existedAtMergeBase, isRegisteredSkill } from '@/authoring/stages/improve.js';
import { skillStatus } from '@/authoring/stages/status.js';
import { SkillWorkspace } from '@/authoring/workspace.js';

const SKILL = (name: string) =>
  `---\nname: ${name}\ndescription: d. Use when asked.\n---\n# Body\n`;

let root: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-new-runtime-skill-'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  write('package.json', JSON.stringify({ name: 'paqad-ai' }));
  write('.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
  write('runtime/base/skills/expert-notes/SKILL.md', SKILL('expert-notes'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function commitBase(): void {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t.dev');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'feat/skill');
}

describe('a runtime skill in the paqad repository', () => {
  it('is new, entry justify, when its folder is missing on the merge base with origin/main', () => {
    commitBase();
    write('runtime/base/skills/skill-orchestrator/SKILL.md', SKILL('skill-orchestrator'));
    const fresh = new SkillWorkspace(root, 'skill-orchestrator');
    expect(existedAtMergeBase(root, 'runtime/base/skills/skill-orchestrator')).toBe(false);
    expect(isRegisteredSkill(fresh)).toBe(false);
    expect(skillStatus(fresh).entry).toBe('justify');
    expect(skillStatus(fresh).next).toBe('paqad-ai skill justify skill-orchestrator');
  });

  it('is installed, entry improve, when the merge base already holds it', () => {
    commitBase();
    write('runtime/base/skills/expert-notes/references/lenses/skill-orchestrator.md', 'lens\n');
    const existing = new SkillWorkspace(root, 'expert-notes');
    expect(existedAtMergeBase(root, 'runtime/base/skills/expert-notes')).toBe(true);
    expect(skillStatus(existing).entry).toBe('improve');
  });

  it('stays improve when git cannot answer (no repository or no origin/main)', () => {
    write('runtime/base/skills/skill-orchestrator/SKILL.md', SKILL('skill-orchestrator'));
    const workspace = new SkillWorkspace(root, 'skill-orchestrator');
    expect(existedAtMergeBase(root, 'runtime/base/skills/skill-orchestrator')).toBeNull();
    expect(skillStatus(workspace).entry).toBe('improve');
  });

  it('a host skill outside the runtime roots is judged by its folder as before', () => {
    commitBase();
    write('.claude/skills/drafting-notes/SKILL.md', SKILL('drafting-notes'));
    expect(skillStatus(new SkillWorkspace(root, 'drafting-notes')).entry).toBe('improve');
  });
});
