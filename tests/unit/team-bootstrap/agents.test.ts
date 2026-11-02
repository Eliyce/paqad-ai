import {
  existsSync,
  lstatSync,
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import { syncTeamSetup, teamSetupMissing } from '@/adapters/claude/team-setup.js';
import {
  knownGeneratedBodies,
  migrateProjectStageAgents,
  stageAgentBodyHash,
} from '@/onboarding/stage-agent-migration.js';
import { PAST_RELEASE_STAGE_AGENT_BODY_HASHES } from '@/onboarding/stage-agent-past-bodies.js';
import {
  STAGE_AGENT_MARKER,
  renderStageAgentFiles,
  withManagedMarker,
} from '@/stage-isolation/agent-writer.js';
import { STAGE_AGENT_STAGES, agentNameForStage } from '@/stage-isolation/stage-agents.js';
import { stageFromAgentType } from '@/stage-isolation/subagent-completion.js';

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

  it('removes stamped copies and writes no manifest when the project has none', () => {
    for (const agent of legacyCopies()) writeAgent(agent.name, agent.content);
    const result = migrateProjectStageAgents(root);
    expect(result.removed).toHaveLength(8);
    expect(readdirSync(agentsDir())).toEqual([]);
    expect(existsSync(manifestPath())).toBe(false);
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

  it('keeps a hand-edited copy that still carries the legacy stamp, and names it', () => {
    const [first] = renderStageAgentFiles('claude-code');
    const handEdited = `${first!.content}my own note\n\n<!-- written by paqad-ai 1.115.0 -->\n`;
    writeAgent(first!.name, handEdited);
    expect(migrateProjectStageAgents(root)).toEqual({
      removed: [],
      kept: [`.claude/agents/${first!.name}`],
    });
    expect(readFileSync(join(agentsDir(), first!.name), 'utf8')).toBe(handEdited);
  });

  it('removes a stamped copy whose body an earlier release generated', () => {
    const pastBody = '---\nname: paqad-planning\n---\n\nAn earlier release body.\n';
    writeAgent('paqad-planning.md', `${pastBody}\n<!-- written by paqad-ai 1.114.0 -->\n`);
    const known = new Set([...knownGeneratedBodies(), stageAgentBodyHash(pastBody)]);
    expect(migrateProjectStageAgents(root, known).removed).toEqual([
      '.claude/agents/paqad-planning.md',
    ]);
  });

  it('knows the bodies of every released stage agent', () => {
    const known = knownGeneratedBodies();
    for (const hash of PAST_RELEASE_STAGE_AGENT_BODY_HASHES) expect(known.has(hash)).toBe(true);
    for (const { content } of renderStageAgentFiles('claude-code')) {
      expect(known.has(stageAgentBodyHash(content))).toBe(true);
    }
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

describe('AC-17: re-onboarding a marked project leaves only the plugin agents', () => {
  it('removes every marked paqad copy, keeps the user agent byte for byte, and every stage dispatches', () => {
    writeFileSync(manifestPath(), `${JSON.stringify({ adapter: 'claude-code' })}\n`);
    for (const { name, content } of renderStageAgentFiles('claude-code')) {
      writeAgent(name, withManagedMarker(content));
    }
    const mine = '---\nname: my-reviewer\n---\n\nMy own agent.\n';
    writeAgent('my-reviewer.md', mine);
    syncTeamSetup(root, {});
    expect(readdirSync(agentsDir()).filter((name) => name.startsWith('paqad-'))).toEqual([]);
    expect(readFileSync(join(agentsDir(), 'my-reviewer.md'), 'utf8')).toBe(mine);
    const pluginAgents = join(process.cwd(), 'runtime', 'claude-plugin', 'agents');
    for (const stage of STAGE_AGENT_STAGES) {
      const name = agentNameForStage(stage);
      expect(existsSync(join(pluginAgents, `${name}.md`))).toBe(true);
      expect(stageFromAgentType(`paqad:${name}`)).toBe(stage);
    }
  });
});

describe('AC-18: the migration keeps what paqad did not write', () => {
  it('leaves a hand-edited copy, a deep marker, a symlink and the Codex agents byte-identical', () => {
    const [first, second] = renderStageAgentFiles('claude-code');
    const handEdited = `${first!.content}my own note\n`;
    writeAgent(first!.name, handEdited);
    const deepMarker = `---\nname: paqad-deep\n---\n\nIntro line.\n${STAGE_AGENT_MARKER}\n`;
    writeAgent('paqad-deep.md', deepMarker);
    const target = join(root, 'elsewhere.md');
    writeFileSync(target, withManagedMarker(second!.content));
    symlinkSync(target, join(agentsDir(), 'paqad-linked.md'));
    const codexDir = join(root, '.codex', 'agents');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, 'paqad-development.toml'), 'name = "paqad-development"\n');

    const result = migrateProjectStageAgents(root);

    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(
      [
        `.claude/agents/${first!.name}`,
        '.claude/agents/paqad-deep.md',
        '.claude/agents/paqad-linked.md',
      ].sort(),
    );
    expect(readFileSync(join(agentsDir(), first!.name), 'utf8')).toBe(handEdited);
    expect(readFileSync(join(agentsDir(), 'paqad-deep.md'), 'utf8')).toBe(deepMarker);
    expect(lstatSync(join(agentsDir(), 'paqad-linked.md')).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(withManagedMarker(second!.content));
    expect(readFileSync(join(codexDir, 'paqad-development.toml'), 'utf8')).toBe(
      'name = "paqad-development"\n',
    );
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, {});
    expect(notes.join('\n')).toContain('.claude/agents/paqad-deep.md');
    expect(notes.join('\n')).toContain('.claude/agents/paqad-linked.md');
  });
});
