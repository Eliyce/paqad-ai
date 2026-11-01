import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import type { InstalledArtifact } from '@/authoring/overlap.js';
import { runAgentEvidence } from '@/authoring/stages/agent-evidence.js';
import { CREATE_OPTION, EXTEND_OPTION } from '@/authoring/stages/sources.js';
import {
  AGENT_STAGES,
  AgentWorkspace,
  renderGateMarkdown,
  stageState,
} from '@/authoring/workspace.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const JOB = 'Review a database migration and say whether it is safe to run.';

function ready(tools: string[] = ['Read', 'Grep']): AgentWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-evidence-'));
  roots.push(root);
  const workspace = new AgentWorkspace(root, 'migration-reviewer');
  workspace.write('justification.md', renderGateMarkdown({ gate: 'passed', stage: 'S0' }, '# J\n'));
  workspace.write('intake.yaml', YAML.stringify({ job: JOB, tools }));
  return workspace;
}

const SOURCES =
  '| S-ID | Fact | Origin | Date | Verified |\n| --- | --- | --- | --- | --- |\n' +
  '| S-1 | migrations live in db/migrations | repository | 2026-11-01 | yes |\n';

function agent(name: string, description: string, tools?: string[]): InstalledArtifact {
  return {
    kind: 'agent',
    name,
    description,
    path: `.claude/agents/${name}.md`,
    scope: 'project',
    ...(tools ? { tools } : {}),
  };
}

describe('agent evidence (S2)', () => {
  it('needs at least one non-model source', () => {
    const workspace = ready();
    expect(() =>
      runAgentEvidence(workspace, {
        sourcesText: SOURCES.replace('repository', 'model'),
        installed: [],
      }),
    ).toThrow(/every source has origin "model"/);
  });

  it('passes with a grounded source and no overlap, writing overlap.md', () => {
    const workspace = ready();
    const result = runAgentEvidence(workspace, { sourcesText: SOURCES, installed: [] });
    expect(result.ok).toBe(true);
    expect(stageState(workspace, AGENT_STAGES[2]!).state).toBe('passed');
    expect(workspace.read('overlap.md')).toContain('No expert collision.');
    expect(workspace.read('overlap.md')).not.toContain('Catalog budget');
  });

  it('a description collision raises authoring.overlap with Extend and Create a new one', () => {
    const workspace = ready();
    const installed = [agent('db-reviewer', 'Review a database migration to say if it is safe.')];
    const result = runAgentEvidence(workspace, { sourcesText: SOURCES, installed });
    expect(result.decision).toMatch(/^D-/);
    expect(stageState(workspace, AGENT_STAGES[2]!).state).toBe('waiting');
    expect(result.lines.at(-1)).toContain('overlaps db-reviewer');

    resolvePendingDecision(workspace.projectRoot, result.decision!, CREATE_OPTION, 'separate');
    const created = runAgentEvidence(workspace, {
      sourcesText: SOURCES,
      installed,
      decision: result.decision,
    });
    expect(created.ok).toBe(true);
  });

  it('Extend clears the workspace and points to agent improve', () => {
    const workspace = ready();
    const installed = [agent('db-reviewer', 'Review a database migration to say if it is safe.')];
    const first = runAgentEvidence(workspace, { sourcesText: SOURCES, installed });
    resolvePendingDecision(workspace.projectRoot, first.decision!, EXTEND_OPTION, 'one');
    const result = runAgentEvidence(workspace, {
      sourcesText: SOURCES,
      installed,
      decision: first.decision,
    });
    expect(result.extend).toBe('db-reviewer');
    expect(result.lines[0]).toContain('paqad-ai agent improve db-reviewer');
    expect(workspace.exists('intake.yaml')).toBe(false);
  });

  it('a tool set and job contained in another agent is a subset overlap', () => {
    const workspace = ready(['Read']);
    const installed = [
      agent(
        'schema-guard',
        'Guards every schema change: review a database migration, say whether it is safe to run, check indexes, foreign keys, triggers, views, seed data, rollbacks, locking, replication lag and backups.',
        ['Read', 'Grep', 'Glob'],
      ),
    ];
    const result = runAgentEvidence(workspace, { sourcesText: SOURCES, installed });
    expect(result.decision).toMatch(/^D-/);
    expect(workspace.read('overlap.md')).toContain('is a subset of schema-guard');
  });

  it('a duplicate name in another scope fails, naming which one wins', () => {
    const workspace = ready();
    const installed: InstalledArtifact[] = [
      { ...agent('migration-reviewer', 'Something else entirely.'), scope: 'managed' },
    ];
    const result = runAgentEvidence(workspace, { sourcesText: SOURCES, installed });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/managed\) would shadow the new project one/);
  });

  it('AC-26: a new expert whose Owns phrase collides is reported with the owner before S3', () => {
    const workspace = ready();
    const result = runAgentEvidence(workspace, {
      sourcesText: SOURCES,
      installed: [],
      owns: 'Will the migration, index and query shape hold up?',
      roster: [{ role: 'db-expert', owns: 'Will the migration, index and query shape hold up?' }],
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('collides with db-expert on its Owns phrase');
    expect(stageState(workspace, AGENT_STAGES[2]!).state).toBe('failed');
  });
});
