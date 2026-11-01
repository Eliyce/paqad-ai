import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderTeamAgents, syncTeamSetup, teamSetupMissing } from '@/adapters/claude/team-setup.js';
import { VERSION } from '@/index.js';
import { renderStageAgentFiles } from '@/stage-isolation/agent-writer.js';

import { HOME_PATH_PATTERN, writeTeamSetup } from './helpers';

const AGENTS = [
  'paqad-checks.md',
  'paqad-chief-architect.md',
  'paqad-development.md',
  'paqad-documentation-sync.md',
  'paqad-expert.md',
  'paqad-planning.md',
  'paqad-review.md',
  'paqad-specification.md',
];

let root: string;
const agentsDir = () => join(root, '.claude', 'agents');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-team-agents-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function optOut(): void {
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'configs', '.config.app'), 'team_bootstrap_enabled=false\n');
}

describe("the stage helpers in the repo's .claude/agents", () => {
  it('writes the 8 rendered helpers with default settings and a version stamp', () => {
    const report = syncTeamSetup(root, {});
    expect(readdirSync(agentsDir()).sort()).toEqual(AGENTS);
    expect(report.written.filter((p) => p.startsWith('.claude/agents/')).sort()).toEqual(
      AGENTS.map((name) => `.claude/agents/${name}`),
    );
    for (const { name, content } of renderStageAgentFiles('claude-code')) {
      const written = readFileSync(join(agentsDir(), name), 'utf8');
      expect(written.startsWith(content)).toBe(true);
      expect(written.endsWith(`\n<!-- written by paqad-ai ${VERSION} -->\n`)).toBe(true);
    }
  });

  it('ignores per-machine stage settings so every machine writes the same bytes', () => {
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(join(root, '.paqad', '.config'), 'stage_model_review=opus\n');
    syncTeamSetup(root, {});
    const review = readFileSync(join(agentsDir(), 'paqad-review.md'), 'utf8');
    expect(review).toContain('model: inherit');
  });

  it('a second run gives identical bytes and writes nothing', () => {
    syncTeamSetup(root, {});
    const before = AGENTS.map((name) => readFileSync(join(agentsDir(), name), 'utf8'));
    expect(syncTeamSetup(root, {}).written).toEqual([]);
    expect(AGENTS.map((name) => readFileSync(join(agentsDir(), name), 'utf8'))).toEqual(before);
  });

  it('no helper holds a home path', () => {
    for (const { content } of renderTeamAgents()) {
      expect(content).not.toMatch(HOME_PATH_PATTERN);
      expect(content).not.toContain(homedir());
    }
  });

  it('the opt-out removes unchanged helpers only and leaves other agents alone', () => {
    syncTeamSetup(root, {});
    const edited = join(agentsDir(), 'paqad-review.md');
    writeFileSync(edited, `${readFileSync(edited, 'utf8')}my own note\n`);
    writeFileSync(join(agentsDir(), 'my-agent.md'), 'mine\n');
    optOut();
    const report = syncTeamSetup(root, {});
    expect(report.removed).toHaveLength(8);
    expect(report.kept).toEqual(['.claude/agents/paqad-review.md']);
    expect(readdirSync(agentsDir()).sort()).toEqual(['my-agent.md', 'paqad-review.md']);
  });

  it('an older paqad leaves helpers written by a newer one alone', () => {
    const newer = renderTeamAgents('999.0.0');
    mkdirSync(agentsDir(), { recursive: true });
    for (const agent of newer) writeFileSync(join(root, agent.path), agent.content);
    const report = syncTeamSetup(root, {}, '1.0.0');
    expect(report.kept.filter((p) => p.startsWith('.claude/agents/'))).toHaveLength(8);
    for (const agent of newer) {
      expect(readFileSync(join(root, agent.path), 'utf8')).toBe(agent.content);
    }
  });

  it('counts a missing helper as a missing team setup', async () => {
    await writeTeamSetup(root);
    expect(teamSetupMissing(root)).toBe(false);
    rmSync(join(agentsDir(), 'paqad-expert.md'));
    expect(teamSetupMissing(root)).toBe(true);
    expect(existsSync(join(root, '.paqad', 'hook.mjs'))).toBe(true);
  });
});
