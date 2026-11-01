import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_INTAKE_FIELDS,
  emptyAgentIntakeFields,
  hasMemoryArm,
  readAgentIntake,
  runAgentIntake,
} from '@/authoring/stages/agent-intake.js';
import { raiseIntakeGap } from '@/authoring/stages/intake.js';
import {
  AgentWorkspace,
  renderGateMarkdown,
  stageState,
  AGENT_STAGES,
} from '@/authoring/workspace.js';
import { readContractDecisions } from '@/decisions/authoring.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function justified(): AgentWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-intake-'));
  roots.push(root);
  const workspace = new AgentWorkspace(root, 'migration-reviewer');
  workspace.write('justification.md', renderGateMarkdown({ gate: 'passed', stage: 'S0' }, '# J\n'));
  return workspace;
}

const INTAKE = {
  job: 'Review a database migration and say whether it is safe to run.',
  delegation_brief: 'The migration path, the schema file and the target database.',
  report: { template: 'Verdict, Risks, Status', max_tokens: 1500 },
  tools: ['Read', 'Grep', 'Glob'],
  model_tier: 'fast',
  effort: 'low',
  stopping: { max_turns: 20, done_when: 'the migration is judged', when_blocked: 'return BLOCKED' },
  memory: 'none',
  isolation: 'none',
  parallel: false,
  cache_ttl: '5m',
  class: 'reviewer',
  invocation: 'auto',
  pattern: 'single-call',
};

describe('agent intake (S1)', () => {
  it('requires all fourteen fields', () => {
    expect(AGENT_INTAKE_FIELDS).toHaveLength(14);
    expect(emptyAgentIntakeFields({})).toEqual([...AGENT_INTAKE_FIELDS]);
    expect(
      emptyAgentIntakeFields({
        ...INTAKE,
        report: { template: 'x' },
        stopping: { max_turns: 0, done_when: 'x', when_blocked: 'y' },
        parallel: 'no',
        tools: [],
      }),
    ).toEqual(['report', 'tools', 'stopping', 'parallel']);
  });

  it('refuses an empty field, naming it', () => {
    const workspace = justified();
    expect(() => runAgentIntake(workspace, YAML.stringify({ ...INTAKE, job: '' }))).toThrow(
      /these fields are empty: job/,
    );
  });

  it('refuses a value outside an enumeration', () => {
    const workspace = justified();
    expect(() =>
      runAgentIntake(workspace, YAML.stringify({ ...INTAKE, class: 'helper', cache_ttl: '2h' })),
    ).toThrow(/cache_ttl must be one of 5m, 1h; class must be one of explorer/);
  });

  it('passes a full intake, maps the class to the S5 task type and records no memory arm for one-shot', () => {
    const workspace = justified();
    const result = runAgentIntake(workspace, YAML.stringify(INTAKE));
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toContain('planted defects it must catch and a clean input');
    expect(result.lines[0]).toContain('S5 runs no memory arm');
    expect(stageState(workspace, AGENT_STAGES[1]!).state).toBe('passed');
    expect(readAgentIntake(workspace)?.class).toBe('reviewer');
    expect(hasMemoryArm(readAgentIntake(workspace)!)).toBe(false);
  });

  it('AC-18: a memory candidate is announced as a with_agent_memory arm', () => {
    const workspace = justified();
    const result = runAgentIntake(workspace, YAML.stringify({ ...INTAKE, memory: 'candidate' }));
    expect(result.lines[0]).toContain('with_agent_memory arm');
  });

  it('raises an intake gap packet for a business field, waiting on it', () => {
    const workspace = justified();
    const result = raiseIntakeGap(
      workspace,
      {
        field: 'invocation',
        question: 'Should it run on its own?',
        options: ['auto', 'dispatched'],
        recommend: 'auto',
      },
      AGENT_INTAKE_FIELDS,
    );
    expect(result.decision).toMatch(/^D-/);
    expect(result.lines[0]).toContain('paqad-ai agent intake migration-reviewer');
    expect(stageState(workspace, AGENT_STAGES[1]!).state).toBe('waiting');
    const packet = readContractDecisions(workspace.projectRoot)[0]!.packet;
    expect(JSON.stringify(packet)).toContain('The agent migration-reviewer needs its invocation');
    expect(() =>
      raiseIntakeGap(
        workspace,
        { field: 'purpose', question: 'q', options: ['a', 'b'], recommend: 'a' },
        AGENT_INTAKE_FIELDS,
      ),
    ).toThrow(/--gap must name an intake field: job/);
  });
});
