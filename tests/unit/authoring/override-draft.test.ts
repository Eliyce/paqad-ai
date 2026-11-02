import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BRIEF_TEMPLATE_FILE,
  MEMORY_FILE,
  agentDraftFile,
  runAgentDraft,
} from '@/authoring/stages/agent-draft.js';
import { runDraft } from '@/authoring/stages/draft.js';
import {
  AgentWorkspace,
  OVERRIDES_FILE,
  SKILL_STAGES,
  SkillWorkspace,
  renderGateMarkdown,
  stageState,
} from '@/authoring/workspace.js';

import { AGENT_NAME, agentText, put } from '../../shared/agent-pipeline.js';

const NAME = 'csv-dedupe';
const SKILL = [
  '---',
  `name: ${NAME}`,
  'description: Removes duplicate rows from a CSV file. Use when a CSV has repeated rows.',
  '---',
  '# Removing duplicates',
  '',
  'Run the script on the file.',
  '',
  '## Gotchas',
  '',
  'Header rows count as data when the file has none.',
  '',
].join('\n');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-override-draft-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code' }),
  );
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({ project: { name: 'x', id: 'x' }, commands: { test: 'npm test' } }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function overridden(workspace: SkillWorkspace | AgentWorkspace, gates: string[]): void {
  workspace.writeJson(
    OVERRIDES_FILE,
    gates.map((gate) => ({
      gate,
      reason: 'owner decision',
      by: 'human',
      at: '2026-10-31T10:00:00.000Z',
      decision: `D-${gate}`,
    })),
  );
}

function skillFolder(rel: string): string {
  mkdirSync(join(root, rel), { recursive: true });
  writeFileSync(join(root, rel, 'SKILL.md'), SKILL);
  return rel;
}

describe('skill draft when S2 evidence is overridden', () => {
  it('passes with an empty trace and lists each block as accepted under the override', () => {
    const workspace = new SkillWorkspace(root, NAME);
    overridden(workspace, ['S0', 'S1', 'S2']);
    const result = runDraft(workspace, {
      dir: join(root, skillFolder('src-skill')),
      traceText: '',
    });
    expect(result.ok).toBe(true);
    expect(stageState(workspace, SKILL_STAGES[3]!).state).toBe('passed');
    const trace = workspace.read('trace.md')!;
    expect(trace).toContain(
      '- Removing duplicates (lines 5-8): accepted: S2 evidence was overridden by decision D-S2',
    );
    expect(trace).toContain(
      '- Gotchas (lines 9-11): accepted: S2 evidence was overridden by decision D-S2',
    );
  });

  it('still fails a block listed under Unsourced without a reason', () => {
    const workspace = new SkillWorkspace(root, NAME);
    overridden(workspace, ['S0', 'S1', 'S2']);
    const result = runDraft(workspace, {
      dir: join(root, skillFolder('src-skill')),
      traceText: '## Unsourced\n\n- Gotchas (lines 9-11): needs a reason\n',
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('unsourced blocks without a reason: Gotchas');
  });

  it('still fails an untraced block when S2 passed on its own', () => {
    const workspace = new SkillWorkspace(root, NAME);
    workspace.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
    workspace.write('intake.yaml', 'purpose: x\n');
    workspace.write('overlap.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
    const result = runDraft(workspace, {
      dir: join(root, skillFolder('src-skill')),
      traceText: '',
    });
    expect(result.ok).toBe(false);
    expect(workspace.read('trace.md')).toContain('Removing duplicates (lines 5-8): needs a reason');
  });
});

describe('agent draft when S1 intake is overridden', () => {
  const FILE = `.claude/agents/${AGENT_NAME}.md`;

  it('drafts with no intake, writes no brief template and lists the blocks under the S2 override', () => {
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    overridden(workspace, ['S0', 'S1', 'S2']);
    put(root, FILE, agentText());
    const result = runAgentDraft(workspace, { file: FILE, traceText: '' });
    expect(result.ok).toBe(true);
    expect(workspace.read(agentDraftFile(workspace))).toBe(agentText());
    expect(workspace.exists(BRIEF_TEMPLATE_FILE)).toBe(false);
    expect(workspace.exists(MEMORY_FILE)).toBe(false);
    expect(workspace.read('trace.md')).toContain(
      'accepted: S2 evidence was overridden by decision D-S2',
    );
  });

  it('writes MEMORY.md only when one is given', () => {
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    overridden(workspace, ['S0', 'S1', 'S2']);
    put(root, FILE, agentText());
    runAgentDraft(workspace, { file: FILE, traceText: '', memoryText: '# Memory\n' });
    expect(workspace.read(MEMORY_FILE)).toBe('# Memory\n');
  });

  it('still refuses to draft with no intake when S1 was not overridden', () => {
    const workspace = new AgentWorkspace(root, AGENT_NAME);
    overridden(workspace, ['S0', 'S2']);
    put(root, FILE, agentText());
    expect(() => runAgentDraft(workspace, { file: FILE, traceText: '' })).toThrow(
      'S1 intake has not passed',
    );
  });
});
