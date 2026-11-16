import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claimUnit } from '@/onboarding/journey/actions.js';
import {
  ONBOARDING_AGENTS,
  moduleAgentBindings,
  moduleAgentWriteRoots,
  recordOnboardingAgentStart,
  recordOnboardingAgentStop,
} from '@/onboarding/journey/agents.js';
import {
  PAQAD_STAGE_HELPER_MATCHER,
  PAQAD_SUBAGENT_START_MATCHER,
} from '@/adapters/shared/paqad-hooks.js';
import { stageHelperStage } from '@/stage-isolation/stage-brief.js';
import { appendEvent, readEvents } from '@/onboarding/journey/events.js';
import { updateRun } from '@/onboarding/journey/run-store.js';
import {
  formatStageAgentWriteSummary,
  stageAgentWriteDecision,
} from '@/stage-isolation/bash-write-guard.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import { unresolvedStageAgent } from '@/stage-isolation/must-not-judge.js';

import { at, clockAt, seedRun, tempRoot } from '../onboarding/journey/fixtures/journey.js';

describe('onboarding stage agents', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-onboarding-agents-');
    seedRun(root);
    updateRun(root, (draft) => {
      draft.stages.detect = { status: 'done' };
      draft.stages.setup = { status: 'done' };
      draft.stages.project_docs = { status: 'done' };
      draft.stages.module_docs = { status: 'running', started_at: at(1) };
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function decide(agentType: string, toolName: string, target: string, agentId?: string): boolean {
    return stageAgentWriteDecision({
      projectRoot: root,
      agentType,
      ...(agentId !== undefined ? { agentId } : {}),
      toolName,
      ...(toolName === 'Bash'
        ? { command: `echo x > ${target}` }
        : { targets: [join(root, target)] }),
    }).blocked;
  }

  it('INV-18: onboarding agents may write docs/instructions/** and .paqad/ but not source', () => {
    expect(decide('paqad-onboarding-docs', 'Write', 'docs/instructions/stack/overview.md')).toBe(
      false,
    );
    expect(decide('paqad:paqad-onboarding-analyze', 'Bash', '.paqad/tmp/batch.json')).toBe(false);
    expect(decide('paqad-onboarding-docs', 'Edit', 'src/index.ts')).toBe(true);
    expect(decide('paqad-onboarding-docs', 'Bash', 'src/index.ts')).toBe(true);
  });

  it('INV-4: the .paqad grant excludes paqad controls', () => {
    for (const target of [
      '.paqad/.config',
      '.paqad/configs/git-workflow/branches.yaml',
      '.paqad/decisions/pending/D-1.json',
      '.paqad/scripts/rules/coding/a.mjs',
      '.paqad/onboarding/journey.json',
    ]) {
      expect(decide('paqad-onboarding-rules', 'Write', target), target).toBe(true);
    }
  });

  it('AC-16 NFR-13: a module agent writes only under the module folder it claimed', () => {
    claimUnit(root, 'module_docs', 'billing', 'paqad-onboarding-modules', clockAt(2));
    expect(decide('paqad-onboarding-modules', 'Write', 'docs/modules/billing/summary.md')).toBe(
      false,
    );
    expect(decide('paqad-onboarding-modules', 'Write', 'docs/modules/auth/summary.md')).toBe(true);
    expect(decide('paqad-onboarding-modules', 'Write', '.claude/settings.json')).toBe(true);
    expect(decide('paqad-onboarding-modules', 'Bash', 'src/billing.ts')).toBe(true);
  });

  it('AC-16: three module agents each write only their own folder, keyed to the agent id', () => {
    const agent = 'paqad-onboarding-modules';
    for (const [minute, slug] of [
      [2, 'billing'],
      [3, 'auth'],
      [4, 'invoices'],
    ] as const) {
      claimUnit(root, 'module_docs', slug, agent, clockAt(minute));
    }
    expect(recordOnboardingAgentStart(root, `paqad:${agent}`, 'agent_a', clockAt(5))).toBe(true);
    expect(recordOnboardingAgentStart(root, agent, 'agent_b', clockAt(5))).toBe(true);
    expect(recordOnboardingAgentStart(root, agent, 'agent_c', clockAt(5))).toBe(true);
    expect(moduleAgentBindings(root)).toEqual(
      new Map([
        ['agent_a', 'billing'],
        ['agent_b', 'auth'],
        ['agent_c', 'invoices'],
      ]),
    );

    expect(decide(agent, 'Write', 'docs/modules/billing/summary.md', 'agent_a')).toBe(false);
    expect(decide(agent, 'Write', 'docs/modules/auth/summary.md', 'agent_a')).toBe(true);
    expect(decide(agent, 'Bash', 'docs/modules/invoices/summary.md', 'agent_a')).toBe(true);
    expect(decide(agent, 'Write', 'docs/modules/auth/summary.md', 'agent_b')).toBe(false);
    expect(decide(agent, 'Edit', 'docs/modules/billing/summary.md', 'agent_b')).toBe(true);
    expect(decide(agent, 'Write', '.claude/settings.json', 'agent_c')).toBe(true);
    expect(decide(agent, 'Bash', 'src/invoices.ts', 'agent_c')).toBe(true);

    const blocked = stageAgentWriteDecision({
      projectRoot: root,
      agentType: agent,
      agentId: 'agent_a',
      toolName: 'Write',
      targets: [join(root, 'docs/modules/auth/summary.md')],
    });
    expect(formatStageAgentWriteSummary(blocked)).toContain('docs/modules/auth/summary.md');

    // An agent with no start row may not write into a folder another agent holds.
    expect(decide(agent, 'Write', 'docs/modules/auth/summary.md', 'agent_unknown')).toBe(true);
    expect(decide(agent, 'Write', 'docs/modules/auth/summary.md')).toBe(true);
  });

  it('AC-16: the kernel and the Bash hook refuse a write into another open module folder', async () => {
    const agent = 'paqad-onboarding-modules';
    writeFileSync(join(root, '.paqad', 'onboarding-manifest.json'), '{"adapter":"claude-code"}\n');
    claimUnit(root, 'module_docs', 'billing', agent, clockAt(2));
    claimUnit(root, 'module_docs', 'auth', agent, clockAt(3));
    recordOnboardingAgentStart(root, agent, 'agent_a', clockAt(4));
    recordOnboardingAgentStart(root, agent, 'agent_b', clockAt(4));
    const gate = (agentId: string, rel: string) =>
      runCapabilityGate({
        projectRoot: root,
        seam: 'pre-mutation',
        env: { PAQAD_STAGES_MODE: 'off' },
        payload: { toolName: 'Write', targetPath: join(root, rel), agentType: agent, agentId },
      });
    expect((await gate('agent_a', 'docs/modules/auth/summary.md')).block).toBe(true);
    expect((await gate('agent_b', 'docs/modules/auth/summary.md')).summary).not.toContain(
      'write blocked',
    );
    const hook = await execa(
      'node',
      [join(process.cwd(), 'runtime/hooks/stage-agent-write-guard.mjs')],
      {
        reject: false,
        input: JSON.stringify({
          session_id: 's',
          cwd: root,
          agent_id: 'agent_a',
          agent_type: `paqad:${agent}`,
          tool_name: 'Bash',
          tool_input: { command: 'echo x > docs/modules/auth/summary.md' },
        }),
        env: { PAQAD_HOOK_ROUTE: '', CLAUDE_PLUGIN_ROOT: '', PAQAD_PROJECT_ROOT: root },
      },
    );
    expect(hook.exitCode).toBe(2);
    expect(hook.stderr).toContain('write blocked');
  });

  it('AC-16: a finished module closes its folder to the agent that held it', () => {
    const agent = 'paqad-onboarding-modules';
    claimUnit(root, 'module_docs', 'billing', agent, clockAt(2));
    recordOnboardingAgentStart(root, agent, 'agent_a', clockAt(3));
    expect(moduleAgentWriteRoots(root, 'agent_a')).toEqual(['docs/modules/billing/']);
    appendEvent(root, {
      ts: at(4),
      run_id: 'run-1',
      kind: 'unit',
      stage: 'module_docs',
      unit: 'billing',
    });
    expect(moduleAgentWriteRoots(root, 'agent_a')).toEqual([]);
    expect(decide(agent, 'Write', 'docs/modules/billing/summary.md', 'agent_a')).toBe(true);
  });

  it('AC-16: an agent started with no claimed module left holds no folder', () => {
    recordOnboardingAgentStart(root, 'paqad-onboarding-modules', 'agent_late', clockAt(3));
    claimUnit(root, 'module_docs', 'billing', 'paqad-onboarding-modules', clockAt(4));
    expect(moduleAgentWriteRoots(root, 'agent_late')).toEqual([]);
    expect(moduleAgentWriteRoots(root)).toEqual(['docs/modules/billing/']);
  });

  it('onboarding agents are resolved, so the fail-closed gate does not deny them', () => {
    for (const agent of ONBOARDING_AGENTS) expect(unresolvedStageAgent(agent.agentName)).toBeNull();
    expect(unresolvedStageAgent('paqad-onboarding-unknown')).toBe('paqad-onboarding-unknown');
  });

  it('INV-19: only the rules agent has network tools; none can ask the person', () => {
    for (const agent of ONBOARDING_AGENTS) {
      expect(agent.claudeTools).not.toContain('AskUserQuestion');
      const network =
        agent.claudeTools.includes('WebFetch') || agent.claudeTools.includes('WebSearch');
      expect(network, agent.agentName).toBe(agent.agentName === 'paqad-onboarding-rules');
    }
    expect(
      ONBOARDING_AGENTS.find((a) => a.agentName === 'paqad-onboarding-docs')?.claudeTools,
    ).toBe('Read, Edit, Write, Grep, Glob, Bash');
  });

  it('INV-17 FR-22: the shipped docs agent is its own file, scoped to step 3, without the stage protocol', () => {
    const file = readFileSync(
      join(process.cwd(), 'runtime/claude-plugin/agents/paqad-onboarding-docs.md'),
      'utf8',
    );
    expect(file).toContain('only during step 3');
    expect(file).not.toContain('paqad-ai stage begin documentation_sync');
    expect(file).toContain('## Report');
  });

  it('AC-21: the SubagentStop judge records agent_stop without a feature handback', () => {
    expect(
      recordOnboardingAgentStop(root, 'paqad:paqad-onboarding-docs', 'max_turns', clockAt(5)),
    ).toBe(true);
    const stop = readEvents(root).find((event) => event.kind === 'agent_stop');
    expect(stop).toMatchObject({
      agent: 'paqad-onboarding-docs',
      stage: 'project_docs',
      action: 'max_turns',
    });
    expect(recordOnboardingAgentStop(root, 'paqad-development', 'done', clockAt(5))).toBe(false);
  });

  it('AC-21 AC-16: SubagentStart matches every onboarding agent and records its agent id', () => {
    const start = new RegExp(PAQAD_SUBAGENT_START_MATCHER);
    for (const agent of ONBOARDING_AGENTS) {
      expect(start.test(agent.agentName), agent.agentName).toBe(true);
      expect(start.test(`paqad:${agent.agentName}`), agent.agentName).toBe(true);
      expect(stageHelperStage(agent.agentName), agent.agentName).toBeNull();
    }
    expect(start.test('paqad-development')).toBe(true);
    expect(start.test('paqad-onboarding-unknown')).toBe(false);
    expect(new RegExp(PAQAD_STAGE_HELPER_MATCHER).test('paqad-onboarding-docs')).toBe(false);
    expect(
      recordOnboardingAgentStart(root, 'paqad:paqad-onboarding-modules', 'agent_m1', clockAt(4)),
    ).toBe(true);
    expect(readEvents(root).find((event) => event.kind === 'agent_bind')).toMatchObject({
      agent: 'paqad-onboarding-modules',
      agent_id: 'agent_m1',
      stage: 'module_docs',
    });
    expect(recordOnboardingAgentStart(root, 'paqad-onboarding-docs', '', clockAt(4))).toBe(false);
    expect(recordOnboardingAgentStart(root, 'paqad-planning', 'agent_p', clockAt(4))).toBe(false);
  });

  it('AC-21: the plugin hooks.json and tsup ship what the onboarding hooks import', () => {
    const hooks = JSON.parse(
      readFileSync(join(process.cwd(), 'runtime/claude-plugin/hooks.json'), 'utf8'),
    ) as { hooks: Record<string, Array<{ matcher?: string }>> };
    expect(hooks.hooks.SubagentStart?.[0]?.matcher).toBe(PAQAD_SUBAGENT_START_MATCHER);
    const tsup = readFileSync(join(process.cwd(), 'tsup.config.ts'), 'utf8');
    expect(tsup).toContain("'onboarding/journey/agents': 'src/onboarding/journey/agents.ts'");
  });
});
