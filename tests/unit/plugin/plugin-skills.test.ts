import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skillsDir = join(repoRoot, 'runtime', 'claude-plugin', 'skills');

const CLAUDE_CODE_SKILLS = ['onboard', 'join', 'dashboard'] as const;

// The first developer step each hand-written skill had before the Claude Code check was added.
const FIRST_DEVELOPER_STEP: Record<(typeof CLAUDE_CODE_SKILLS)[number], string> = {
  onboard: 'You are the project lead setting paqad up for the whole team.',
  join: 'The project is already onboarded (it has a committed `.paqad/`). This sets up only your machine.',
  dashboard: 'The dashboard is a local web app for this project. It never leaves the machine.',
};

function body(name: string): string {
  const text = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
  const end = text.indexOf('\n---\n', 4);
  return text.slice(end + '\n---\n'.length);
}

describe('hand-written plugin skills', () => {
  it.each(CLAUDE_CODE_SKILLS)(
    'AC-12: %s opens with the Claude Code check and keeps its developer steps',
    (name) => {
      const paragraphs = body(name)
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);
      expect(paragraphs[0]).toMatch(/^# /);
      const check = paragraphs[1];
      expect(check).toContain('If there is no shell and no project folder open');
      expect(check).toContain('reply in one sentence that this works in Claude Code');
      expect(check).toContain('and stop');
      expect(check).toContain('do not mention this check');
      expect(paragraphs[2]).toBe(FIRST_DEVELOPER_STEP[name]);
    },
  );
});
