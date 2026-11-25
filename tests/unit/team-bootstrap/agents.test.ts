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
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from '@/adapters/claude/claude-adapter.js';
import {
  syncTeamSetup,
  teamFilesToCommit,
  teamSetupMissing,
} from '@/adapters/claude/team-setup.js';
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

import { writeTeamSetup } from './helpers';

const OFF = { PAQAD_TEAM_BOOTSTRAP_ENABLED: 'false' };
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
  it('AC-1: a team setup with it on writes the 6 stage, 2 High Table and 5 onboarding agents with the managed marker', () => {
    const report = syncTeamSetup(root, {});
    const rendered = renderStageAgentFiles('claude-code');
    expect(rendered).toHaveLength(13);
    for (const { name, content } of rendered) {
      expect(readFileSync(join(agentsDir(), name), 'utf8')).toBe(withManagedMarker(content));
      expect(report.written).toContain(`.claude/agents/${name}`);
    }
    expect(syncTeamSetup(root, {}).written).toEqual([]);
  });

  it('AC-2: a team setup with it on keeps a hand-edited copy and a symlink and names them', () => {
    const [first, second] = renderStageAgentFiles('claude-code');
    const handEdited = `${first!.content}my own note\n`;
    writeAgent(first!.name, handEdited);
    const target = join(root, 'elsewhere.md');
    writeFileSync(target, 'mine\n');
    symlinkSync(target, join(agentsDir(), second!.name));
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, {});
    expect(readFileSync(join(agentsDir(), first!.name), 'utf8')).toBe(handEdited);
    expect(lstatSync(join(agentsDir(), second!.name)).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('mine\n');
    expect(notes.join('\n')).toContain(`.claude/agents/${first!.name}`);
    expect(notes.join('\n')).toContain(`.claude/agents/${second!.name}`);
  });

  it('names a pending hand-edited copy only as kept, never as a file to commit', () => {
    const [first] = renderStageAgentFiles('claude-code');
    writeAgent(first!.name, `${first!.content}my own note\n`);
    execFileSync('git', ['init', '-q'], { cwd: root });
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, {});
    const commitNote = notes.find((note) => note.startsWith('Commit these team setup files'));
    const keptNote = notes.find((note) => note.includes('do not match what paqad wrote'));
    expect(commitNote).not.toContain(`.claude/agents/${first!.name}`);
    expect(keptNote).toContain(`.claude/agents/${first!.name}`);
  });

  it('a team setup with it on keeps a folder that has an agent file name', () => {
    const [first] = renderStageAgentFiles('claude-code');
    mkdirSync(join(agentsDir(), first!.name), { recursive: true });
    const report = syncTeamSetup(root, {});
    expect(lstatSync(join(agentsDir(), first!.name)).isDirectory()).toBe(true);
    expect(report.kept).toContain(`.claude/agents/${first!.name}`);
    expect(report.written.filter((path) => path.startsWith('.claude/agents/'))).toHaveLength(12);
  });

  it('a team setup with it on rewrites an older paqad copy', () => {
    const [legacy] = legacyCopies();
    writeAgent(legacy!.name, legacy!.content);
    const report = syncTeamSetup(root, {});
    expect(report.written).toContain(`.claude/agents/${legacy!.name}`);
    expect(readFileSync(join(agentsDir(), legacy!.name), 'utf8')).toContain(STAGE_AGENT_MARKER);
  });

  it('removes stamped copies and writes no manifest when the project has none', () => {
    for (const agent of legacyCopies()) writeAgent(agent.name, agent.content);
    const result = migrateProjectStageAgents(root);
    expect(result.removed).toHaveLength(13);
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

describe('AC-41: team setup off still writes the project agents (FR-8)', () => {
  it('AC-41: writes the 13 agents and the agents block, and the commit note names no agent', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const mine = '---\nname: my-reviewer\n---\n\nMy own agent.\n';
    writeAgent('my-reviewer.md', mine);
    const { report, notes } = new ClaudeCodeAdapter().syncTeamSetup(root, OFF);
    for (const { name, content } of renderStageAgentFiles('claude-code')) {
      expect(readFileSync(join(agentsDir(), name), 'utf8')).toBe(withManagedMarker(content));
    }
    expect(readFileSync(join(agentsDir(), '.gitignore'), 'utf8')).toContain('paqad-*');
    expect(readFileSync(join(agentsDir(), 'my-reviewer.md'), 'utf8')).toBe(mine);
    expect(teamFilesToCommit(root, report).filter((path) => path.includes('/paqad-'))).toEqual([]);
    expect(notes.join('\n')).not.toMatch(/Commit these[^\n]*paqad-[a-z-]+\.md/u);
    expect(notes.join('\n')).not.toContain('Removed the old paqad stage agents');
  });

  it('AC-41: rewrites copies stamped by an earlier paqad instead of removing them', () => {
    for (const agent of legacyCopies()) writeAgent(agent.name, agent.content);
    const report = syncTeamSetup(root, OFF);
    expect(report.removed).toEqual([]);
    expect(report.written.filter((path) => path.startsWith('.claude/agents/paqad-'))).toHaveLength(
      13,
    );
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
    const { notes } = new ClaudeCodeAdapter().syncTeamSetup(root, OFF);
    expect(notes.join('\n')).toContain('.claude/agents/paqad-deep.md');
    expect(notes.join('\n')).toContain('.claude/agents/paqad-linked.md');
  });
});
