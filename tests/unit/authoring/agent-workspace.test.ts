import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFECTS_LEDGER, readAuthoringDefects, recordGateFailure } from '@/authoring/evidence.js';
import { askForOverride } from '@/authoring/stages/override.js';
import { agentStatus } from '@/authoring/stages/status.js';
import {
  AGENT_STAGES,
  AGENT_TRACKED_ROOT,
  AGENT_WORKSPACE_ROOT,
  AgentWorkspace,
  AuthoringRefusal,
  allStageStates,
  renderGateMarkdown,
  requireEarlierGates,
  SkillWorkspace,
  stageById,
  validateAgentName,
} from '@/authoring/workspace.js';
import { readContractDecisions } from '@/decisions/authoring.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-workspace-'));
  roots.push(root);
  return root;
}

describe('validateAgentName', () => {
  it('accepts object-role hyphenated names and the built-in Explore override', () => {
    expect(validateAgentName('code-reviewer')).toBe('code-reviewer');
    expect(validateAgentName('Explore')).toBe('Explore');
    expect(validateAgentName('a'.repeat(256))).toBe('a'.repeat(256));
  });

  it.each(['', '../x', 'a/b', '.hidden', '-lead', 'has:colon', 'Code-Reviewer', 'a'.repeat(257)])(
    'refuses %j before any path is built',
    (name) => {
      expect(() => validateAgentName(name)).toThrow(AuthoringRefusal);
      expect(() => new AgentWorkspace(project(), name)).toThrow(AuthoringRefusal);
    },
  );
});

describe('AgentWorkspace', () => {
  it('lives under the agent roots with the agent stage table', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, 'db-reader');
    expect(workspace.kind).toBe('agent');
    expect(workspace.rel).toBe(`${AGENT_WORKSPACE_ROOT}/db-reader`);
    expect(workspace.trackedRoot).toBe(AGENT_TRACKED_ROOT);
    expect(workspace.stages).toBe(AGENT_STAGES);
    expect(AGENT_STAGES.map((stage) => stage.artifact)).toEqual([
      'justification.md',
      'intake.yaml',
      'overlap.md',
      'trace.md',
      'script-tests.json',
      'benchmark.json',
      'delegation-results.json',
      'release.json',
    ]);
    expect(stageById('S6', AGENT_STAGES).name).toBe('delegation');
    expect(() => stageById('S9', AGENT_STAGES)).toThrow('unknown agent stage S9');
    expect(() => stageById('S9')).toThrow('unknown skill stage S9');
    expect(new SkillWorkspace(root, 'db-reader').kind).toBe('skill');
  });

  it('AC-1: a stage from S1 on refuses without a passing justification, naming the artifact and paqad-ai agent justify', () => {
    const workspace = new AgentWorkspace(project(), 'db-reader');
    for (const stage of AGENT_STAGES.slice(1)) {
      expect(() => requireEarlierGates(workspace, stage.id)).toThrow(
        `The missing artifact is ${AGENT_WORKSPACE_ROOT}/db-reader/justification.md. Run paqad-ai agent justify db-reader`,
      );
    }
    workspace.write('justification.md', renderGateMarkdown({ gate: 'failed' }, 'no'));
    expect(() => requireEarlierGates(workspace, 'S1')).toThrow('its gate is failed');
    workspace.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'ok'));
    expect(() => requireEarlierGates(workspace, 'S1')).not.toThrow();
    expect(() => requireEarlierGates(workspace, 'S2')).toThrow(
      'paqad-ai agent intake db-reader <intake.yaml>',
    );
  });

  it('AC-53: status names the last passed stage and the exact next verb to run', () => {
    const root = project();
    const workspace = new AgentWorkspace(root, 'db-reader');
    workspace.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'ok'));
    workspace.write('intake.yaml', 'job: x\n');
    const status = agentStatus(new AgentWorkspace(root, 'db-reader'));
    expect(status.entry).toBe('justify');
    expect(status.lines[0]).toBe('Entry: paqad-ai agent justify db-reader (a new agent).');
    expect(status.lines).toContain(
      `S1 intake: passed (${AGENT_WORKSPACE_ROOT}/db-reader/intake.yaml)`,
    );
    expect(status.next).toBe('paqad-ai agent evidence db-reader <sources.md>');
    expect(allStageStates(workspace)).toHaveLength(8);
  });

  it('a released agent enters through improve', () => {
    const root = project();
    mkdirSync(join(root, AGENT_TRACKED_ROOT, 'db-reader'), { recursive: true });
    writeFileSync(join(root, AGENT_TRACKED_ROOT, 'db-reader', 'evidence.json'), '{}');
    const status = agentStatus(new AgentWorkspace(root, 'db-reader'));
    expect(status.entry).toBe('improve');
    expect(status.lines[0]).toBe(
      'Entry: paqad-ai agent improve db-reader (the agent is already installed).',
    );
    expect(status.next).toBe('paqad-ai agent improve db-reader');
  });
});

describe('agent overrides', () => {
  function withLint(rules: string[]): AgentWorkspace {
    const workspace = new AgentWorkspace(project(), 'db-reader');
    workspace.writeJson('lint.json', { findings: rules.map((rule) => ({ rule })) });
    return workspace;
  }

  it('AC-33: never lets an override clear an AG-012 secret finding', () => {
    expect(() => askForOverride(withLint(['AG-012']), { gate: 'S4', why: 'x' })).toThrow(
      'db-reader holds a secret (AG-012). A secret can never be approved or skipped: remove the value, rerun paqad-ai agent draft and paqad-ai agent test.',
    );
  });

  it('never lets an override clear a risky power', () => {
    expect(() =>
      askForOverride(withLint(['AG-022', 'AG-015', 'AG-022']), { gate: 'S4', why: 'x' }),
    ).toThrow(
      "db-reader asks for risky powers (AG-015, AG-022). An override can't clear them: only a resolved authoring.agent_permission packet can",
    );
  });

  it('raises an agent override packet for any other gate', () => {
    const workspace = withLint(['AG-022']);
    const result = askForOverride(workspace, { gate: 'S5', why: 'no model access' });
    expect(result.lines[0]).toContain('run paqad-ai agent override db-reader --gate S5 --decision');
    const packet = readContractDecisions(workspace.projectRoot)[0]!.packet;
    expect(packet.title).toBe(
      'The agent db-reader cannot run its S5 check. Add it unverified, kept in this project?',
    );
  });

  it('refuses the release gate and an unknown gate', () => {
    expect(() => askForOverride(withLint([]), { gate: 'S7', why: 'x' })).toThrow(
      "Release itself can't be skipped",
    );
  });
});

describe('agent defects', () => {
  it('rows for agents carry kind agent and old skill rows still read', () => {
    const root = project();
    const line = recordGateFailure(root, {
      skill: 'db-reader',
      gate: 'S5',
      evidencePath: 'p',
      kind: 'agent',
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(line).toBe(
      "I couldn't get the agent db-reader through its S5 check, so I didn't add it. The evidence is in p. This is ours to fix, not yours.",
    );
    recordGateFailure(root, { skill: 'old', gate: 'S6', evidencePath: 'q' });
    const rows = readFileSync(join(root, DEFECTS_LEDGER), 'utf8').trim().split('\n');
    expect(JSON.parse(rows[0]!).kind).toBe('agent');
    expect(JSON.parse(rows[1]!).kind).toBeUndefined();
    expect(readAuthoringDefects(root).map((row) => row.skill)).toEqual(['db-reader', 'old']);
  });
});
