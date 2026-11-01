import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { syncTeamSetup, teamSetupMissing } from '@/adapters/claude/team-setup.js';
import { migrateProjectStageAgents } from '@/onboarding/stage-agent-migration.js';
import {
  STAGE_AGENT_MARKER,
  renderStageAgentFiles,
  withManagedMarker,
} from '@/stage-isolation/agent-writer.js';

import { writeTeamSetup } from './helpers';

let root: string;
const agentsDir = () => join(root, '.claude', 'agents');
const manifestPath = () => join(root, '.paqad', 'onboarding-manifest.json');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-team-agents-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeAgent(name: string, content: string): void {
  mkdirSync(agentsDir(), { recursive: true });
  writeFileSync(join(agentsDir(), name), content);
}

function legacyCopies(): { name: string; content: string }[] {
  return renderStageAgentFiles('claude-code').map(({ name, content }) => ({
    name,
    content: `${content}\n<!-- written by paqad-ai 1.100.0 -->\n`,
  }));
}

describe("the stage agents in the repo's .claude/agents", () => {
  it('a fresh team setup writes no paqad stage agent into the project', () => {
    const report = syncTeamSetup(root, {});
    expect(existsSync(agentsDir())).toBe(false);
    expect(report.written).toEqual(['.paqad/hook.mjs']);
  });

  it('removes copies stamped by an earlier paqad and records each removal', () => {
    writeFileSync(manifestPath(), `${JSON.stringify({ adapter: 'claude-code' })}\n`);
    for (const agent of legacyCopies()) writeAgent(agent.name, agent.content);
    const report = syncTeamSetup(root, {});
    expect(readdirSync(agentsDir())).toEqual([]);
    expect(report.removed.filter((path) => path.startsWith('.claude/agents/'))).toHaveLength(8);
    const manifest = JSON.parse(readFileSync(manifestPath(), 'utf8')) as {
      removed_stage_agents: { path: string; reason: string }[];
    };
    expect(manifest.removed_stage_agents).toHaveLength(8);
    expect(new Set(manifest.removed_stage_agents.map((entry) => entry.reason))).toEqual(
      new Set(['legacy-stamp']),
    );
  });

  it('removes a copy whose first body line carries the managed marker', () => {
    const [first] = renderStageAgentFiles('claude-code');
    writeAgent(first!.name, withManagedMarker(`${first!.content}one more line\n`));
    expect(migrateProjectStageAgents(root)).toEqual({
      removed: [`.claude/agents/${first!.name}`],
      kept: [],
    });
  });

  it('removes an unmarked copy whose content matches a body paqad generated', () => {
    const [first] = renderStageAgentFiles('claude-code');
    writeAgent(first!.name, first!.content);
    expect(migrateProjectStageAgents(root).removed).toEqual([`.claude/agents/${first!.name}`]);
  });

  it('keeps a hand-edited copy, names it, and leaves other agents alone', () => {
    const [first] = renderStageAgentFiles('claude-code');
    writeAgent(first!.name, `${first!.content}my own note\n`);
    writeAgent('my-agent.md', 'mine\n');
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, {});
    expect(readdirSync(agentsDir()).sort()).toEqual(['my-agent.md', first!.name].sort());
    expect(notes.join('\n')).toContain(`.claude/agents/${first!.name}`);
    expect(notes.join('\n')).toContain('do not match what paqad wrote');
  });

  it('names the removed files in what the lead is told', () => {
    for (const agent of legacyCopies()) writeAgent(agent.name, agent.content);
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, {});
    expect(notes.join('\n')).toContain('.claude/agents/paqad-review.md');
  });

  it('a second run removes nothing more and keeps the recorded removals', () => {
    writeFileSync(manifestPath(), `${JSON.stringify({ adapter: 'claude-code' })}\n`);
    for (const agent of legacyCopies()) writeAgent(agent.name, agent.content);
    syncTeamSetup(root, {});
    const before = readFileSync(manifestPath(), 'utf8');
    expect(migrateProjectStageAgents(root)).toEqual({ removed: [], kept: [] });
    expect(readFileSync(manifestPath(), 'utf8')).toBe(before);
  });

  it('the managed marker sits on the first line after the frontmatter', () => {
    const [first] = renderStageAgentFiles('claude-code');
    const lines = withManagedMarker(first!.content).split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[lines.indexOf('---', 1) + 1]).toBe(STAGE_AGENT_MARKER);
  });

  it('a team setup with no stage agents in the project is not missing', async () => {
    await writeTeamSetup(root);
    expect(teamSetupMissing(root)).toBe(false);
    expect(existsSync(join(root, '.paqad', 'hook.mjs'))).toBe(true);
  });
});
