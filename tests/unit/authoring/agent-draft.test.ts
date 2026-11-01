import { afterEach, describe, expect, it } from 'vitest';

import {
  BRIEF_TEMPLATE_FILE,
  MEMORY_FILE,
  agentDraftFile,
  missingBlockedShape,
  readAgentDraftSource,
  runAgentDraft,
} from '@/authoring/stages/agent-draft.js';
import { AGENT_STAGES, AuthoringRefusal, stageState } from '@/authoring/workspace.js';

import {
  AGENT_BODY,
  AGENT_INTAKE,
  AGENT_TRACE,
  agentText,
  agentThrough,
  cleanAgentProjects,
  put,
} from '../../shared/agent-pipeline.js';

afterEach(cleanAgentProjects);

const FILE = '.claude/agents/migration-reviewer.md';

describe('agent draft (S3)', () => {
  it('copies the agent file, writes the brief template and passes a traced body', () => {
    const workspace = agentThrough('S3');
    put(workspace.projectRoot, FILE, agentText());
    const result = runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
    expect(result.lines[0]).toMatch(/S3 draft passed: all 6 instruction blocks are traced/);
    expect(result.ok).toBe(true);
    expect(stageState(workspace, AGENT_STAGES[3]!).state).toBe('passed');
    expect(workspace.read(agentDraftFile(workspace))).toBe(agentText());
    const brief = workspace.read(BRIEF_TEMPLATE_FILE)!;
    for (const heading of [
      'Where the task fits',
      'Files and interfaces',
      'Resolved decisions',
      'Report path',
    ]) {
      expect(brief).toContain(`## ${heading}`);
    }
    expect(brief).toContain('at most 1500 tokens');
    expect(workspace.exists(MEMORY_FILE)).toBe(false);
    expect(readAgentDraftSource(workspace)).toEqual({ file: FILE, hook_scripts: [] });
  });

  it('copies the hook scripts the agent names, by project-relative path', () => {
    const workspace = agentThrough('S3');
    put(workspace.projectRoot, 'scripts/guard.sh', '#!/bin/sh\nexit 0\n');
    const hooks =
      '\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: scripts/guard.sh';
    put(workspace.projectRoot, FILE, agentText({ hooks }));
    const result = runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
    expect(result.ok).toBe(true);
    expect(workspace.read('draft/scripts/guard.sh')).toContain('exit 0');
    expect(readAgentDraftSource(workspace)?.hook_scripts).toEqual(['scripts/guard.sh']);
  });

  it('refuses a hook script that does not exist on disk', () => {
    const workspace = agentThrough('S3');
    const hooks =
      '\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: scripts/none.sh';
    put(workspace.projectRoot, FILE, agentText({ hooks }));
    expect(() => runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE })).toThrow(
      /scripts\/none.sh named by .* do not exist/,
    );
  });

  it('fails a body over agent_prompt_max_tokens, out of heading order, or without the BLOCKED shape', () => {
    const workspace = agentThrough('S3');
    put(workspace.projectRoot, '.paqad/.config', 'agent_prompt_max_tokens=50\n');
    const shuffled = AGENT_BODY.replace('## Stop when', '## Tmp')
      .replace('## Do not', '## Stop when')
      .replace('## Tmp', '## Do not')
      .replace('Decision needed: <question>\n', '');
    put(workspace.projectRoot, FILE, agentText({}, shuffled));
    const result = runAgentDraft(workspace, { file: FILE, traceText: AGENT_TRACE });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/over agent_prompt_max_tokens \(50\)/);
    expect(result.lines[0]).toMatch(/headings must come in the order/);
    expect(result.lines[0]).toMatch(/BLOCKED report shape is missing "Decision needed:"/);
    expect(stageState(workspace, AGENT_STAGES[3]!).state).toBe('failed');
  });

  it('fails an instruction block with no S-ID', () => {
    const workspace = agentThrough('S3');
    put(workspace.projectRoot, FILE, agentText());
    const result = runAgentDraft(workspace, {
      file: FILE,
      traceText: AGENT_TRACE.replace('| Example | 1 | S-1 |', ''),
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('unsourced blocks without a reason: Example');
  });

  it('AC-18: seeds MEMORY.md only for a memory candidate, and refuses it for a one-shot agent', () => {
    const oneShot = agentThrough('S3');
    put(oneShot.projectRoot, FILE, agentText());
    expect(() =>
      runAgentDraft(oneShot, { file: FILE, traceText: AGENT_TRACE, memoryText: '# M\n' }),
    ).toThrow(AuthoringRefusal);

    const candidate = agentThrough('S3', { ...AGENT_INTAKE, memory: 'candidate' });
    put(candidate.projectRoot, FILE, agentText());
    runAgentDraft(candidate, { file: FILE, traceText: AGENT_TRACE, memoryText: '# Seed\n' });
    expect(candidate.read(MEMORY_FILE)).toBe('# Seed\n');
  });

  it('AC-1: refuses before S2 has passed, and a refused draft records a defect', () => {
    const early = agentThrough('S2');
    expect(() => runAgentDraft(early, { file: FILE, traceText: AGENT_TRACE })).toThrow(
      /S2 evidence has not passed/,
    );
    const workspace = agentThrough('S3');
    const refused = runAgentDraft(workspace, { traceText: '', refuse: 'purpose mismatch' });
    expect(refused.ok).toBe(false);
    expect(stageState(workspace, AGENT_STAGES[3]!).state).toBe('failed');
  });

  it('refuses a file outside the project root', () => {
    const workspace = agentThrough('S3');
    expect(() => runAgentDraft(workspace, { file: '../x.md', traceText: AGENT_TRACE })).toThrow(
      /outside the project root/,
    );
  });

  it('names each missing line of the BLOCKED shape', () => {
    expect(missingBlockedShape('Status: BLOCKED\nOptions: a, b')).toEqual(['Decision needed:']);
  });
});
