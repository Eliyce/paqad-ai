import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import {
  PAQAD_STAGE_AGENT_MATCHER,
  PAQAD_STAGE_HELPER_MATCHER,
  buildHostHookChain,
  buildPluginHookChain,
} from '@/adapters/shared/paqad-hooks.js';
import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import {
  formatUnresolvedStageSummary,
  judgeMustNot,
  transcriptToolUses,
  unresolvedStageAgent,
} from '@/stage-isolation/must-not-judge.js';
import { recordStageAgentCompletion } from '@/stage-isolation/subagent-completion.js';

import { useTempRoots } from '../_helpers/temp-roots.js';

const tempRoot = useTempRoots('paqad-must-not-');
const GATE = join(process.cwd(), 'runtime/hooks/capability-gate.mjs');

function toolUseLine(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] },
  });
}

function textLine(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function stagesOff(root: string): void {
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'configs', '.config.policy'), 'stages_mode=off\n');
}

function activeFeature(root: string): string {
  const dir = openFeatureChange(root, 'ses_orch', {
    adapter: 'claude-code',
    title: 'Must not',
    issue: '12',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
  persistLedgerSessionId(root, 'ses_orch');
  return dir;
}

describe('AC-25: a paqad subagent whose stage cannot be resolved is denied (fail closed)', () => {
  it('names the agent with no stage and leaves stage, seat and non-paqad agents alone', () => {
    expect(unresolvedStageAgent('paqad:paqad-deploy')).toBe('paqad-deploy');
    expect(unresolvedStageAgent('paqad-')).toBe('paqad-');
    expect(unresolvedStageAgent('paqad:paqad-development')).toBeNull();
    expect(unresolvedStageAgent('paqad-documentation-sync')).toBeNull();
    expect(unresolvedStageAgent('paqad:paqad-expert')).toBeNull();
    expect(unresolvedStageAgent('paqad-chief-architect')).toBeNull();
    expect(unresolvedStageAgent('general-purpose')).toBeNull();
    expect(unresolvedStageAgent(undefined)).toBeNull();
    expect(formatUnresolvedStageSummary('paqad-deploy')).toContain(
      'no active stage for `paqad-deploy`',
    );
  });

  it('the pre-mutation kernel blocks the edit even with stages mode off', async () => {
    const root = tempRoot();
    stagesOff(root);
    const denied = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { toolName: 'Edit', targetPath: 'src/a.ts', agentType: 'paqad:paqad-deploy' },
    });
    expect(denied.block).toBe(true);
    expect(denied.summary).toContain('paqad-deploy');
    expect(denied.summary).toContain('cannot be resolved');

    const allowed = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { toolName: 'Edit', targetPath: 'src/a.ts', agentType: 'paqad:paqad-development' },
    });
    expect(allowed.block).toBe(false);
  });

  it('the PreToolUse capability-gate hook exits with a deny naming the missing stage', async () => {
    const root = tempRoot();
    stagesOff(root);
    writeFileSync(join(root, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current\n');
    const result = await execa('node', [GATE, 'pre-mutation'], {
      input: JSON.stringify({
        session_id: 's-1',
        tool_name: 'Write',
        tool_input: { file_path: join(root, 'src', 'a.ts'), content: 'x' },
        agent_type: 'paqad:paqad-deploy',
        agent_id: 'a1',
      }),
      env: {
        PATH: process.env.PATH ?? '',
        HOME: root,
        USERPROFILE: root,
        CLAUDE_PROJECT_DIR: root,
      },
      extendEnv: false,
      reject: false,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('paqad-deploy');
  });
});

describe('AC-24: the SubagentStop judge records the must-not breaches', () => {
  it('reads the agent transcript tool calls', () => {
    const raw = [
      toolUseLine('Read', { file_path: 'a' }),
      'not json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: [] } }),
      toolUseLine('AskUserQuestion', { questions: [] }),
    ].join('\n');
    expect(transcriptToolUses(raw).map((use) => use.name)).toEqual(['Read', 'AskUserQuestion']);
  });

  it('flags an ask, a bundle write and an out-of-stage edit, and nothing on a clean run', () => {
    const bundle = '/p/.paqad/ledger/feature-evidence/1-x-01J/plan.json';
    expect(
      judgeMustNot('review', [
        { name: 'Write', input: { file_path: bundle } },
        { name: 'Edit', input: { file_path: '/p/src/a.ts' } },
        { name: 'AskUserQuestion', input: {} },
      ]),
    ).toEqual(['asked_human', 'bundle_write', 'out_of_stage_edit']);
    expect(
      judgeMustNot('development', [{ name: 'Edit', input: { file_path: '/p/src/a.ts' } }]),
    ).toEqual([]);
    expect(judgeMustNot('development', [{ name: 'Write', input: { file_path: bundle } }])).toEqual([
      'bundle_write',
    ]);
    expect(judgeMustNot('planning', [{ name: 'Bash', input: { command: 'ls' } }])).toEqual([]);
  });

  it('writes report status and the breach on the stage-agent row, and stops the advance', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(
      transcript,
      [toolUseLine('AskUserQuestion', { questions: [] }), textLine('done\nStatus: DONE')].join(
        '\n',
      ),
    );
    expect(
      recordStageAgentCompletion({
        projectRoot: root,
        payload: {
          agent_type: 'paqad:paqad-review',
          agent_id: 'a-1',
          session_id: 'ses_orch',
          agent_transcript_path: transcript,
        },
        transcriptText: '',
        adapter: 'claude-code',
      }),
    ).toBe(true);
    const row = readFeatureStageUnit(root, dir).find((r) => r.kind === 'stage-agent')!;
    expect(row).toMatchObject({
      report_status: 'DONE',
      report_stated: true,
      advance: false,
      must_not: ['asked_human'],
    });
    expect(validateStageEvidenceRow(row)).toEqual([]);
  });

  it('a clean return with no Status line is recorded as BLOCKED and does not advance', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const transcript = join(root, 'agent.jsonl');
    writeFileSync(transcript, textLine('I ran out of turns.'));
    recordStageAgentCompletion({
      projectRoot: root,
      payload: {
        agent_type: 'paqad-checks',
        session_id: 'ses_orch',
        agent_transcript_path: transcript,
      },
      transcriptText: '',
      adapter: 'claude-code',
    });
    const row = readFeatureStageUnit(root, dir).find((r) => r.kind === 'stage-agent')!;
    expect(row).toMatchObject({ report_status: 'BLOCKED', report_stated: false, advance: false });
    expect(row.must_not).toBeUndefined();
  });
});

describe('AC-22: the SubagentStart and SubagentStop entries keep their command and matcher', () => {
  const env = { PAQAD_FRAMEWORK_HOME: '/fw' } as NodeJS.ProcessEnv;

  it('renders one SubagentStart and one stage SubagentStop entry per route', () => {
    for (const chain of [buildHostHookChain('claude-code', env), buildPluginHookChain(env)]) {
      const start = chain.filter((hook) => hook.nativeEvent === 'SubagentStart');
      expect(start).toHaveLength(1);
      expect(start[0]!.matcher).toBe(PAQAD_STAGE_HELPER_MATCHER);
      expect(start[0]!.command).toMatch(/hooks\/stage-agent-start\.mjs"$/u);
      const stop = chain.filter(
        (hook) => hook.nativeEvent === 'SubagentStop' && hook.matcher === PAQAD_STAGE_AGENT_MATCHER,
      );
      expect(stop).toHaveLength(1);
      expect(stop[0]!.command).toMatch(/hooks\/stage-agent-completion\.mjs"$/u);
    }
    expect(buildHostHookChain('claude-code', env).map((hook) => hook.command)).toContain(
      'node "/fw/hooks/stage-agent-start.mjs"',
    );
  });
});
