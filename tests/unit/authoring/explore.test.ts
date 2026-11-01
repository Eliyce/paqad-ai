import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXPLORE_NAME,
  exploreOfferLine,
  explorePreset,
  exploreRegistrationProblem,
  hostAllowsBuiltinOverride,
  runExploreIntake,
} from '@/authoring/explore.js';
import { planAgentRelease } from '@/authoring/stages/agent-release.js';
import { readAgentIntake } from '@/authoring/stages/agent-intake.js';
import { baselineArmFor } from '@/authoring/stages/agent-eval.js';
import { AgentWorkspace, AuthoringRefusal } from '@/authoring/workspace.js';
import { parseAgentSource } from '@/authoring/package/agent-render.js';

import { agentProject, agentText, cleanAgentProjects, put } from '../../shared/agent-pipeline.js';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanAgentProjects();
});

const metrics = (pass: number, cost: number | null) => ({
  pass_hat_k: pass,
  tokens_median: 100,
  cost_median: cost,
  latency_ms: 10,
});

describe('the cheap-tier Explore override', () => {
  it('AC-32: the preset is read-only on the fast model with 30 turns, a 2,000 token report and no CLAUDE.md', () => {
    const root = agentProject();
    const preset = explorePreset(root);
    expect(preset.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(preset.model_tier).toBe('fast');
    expect(typeof preset.model).toBe('string');
    expect((preset.stopping as { max_turns: number }).max_turns).toBe(30);
    expect((preset.report as { max_tokens: number }).max_tokens).toBe(2000);
    expect(preset.omit_claude_md).toBe(true);
    expect(preset.class).toBe('explorer');
    expect(preset.baseline_arm).toBe('builtin_explore');
  });

  it('agent intake Explore --preset explore skips S0 and passes S1, and the S5 baseline is the built-in', () => {
    const root = agentProject();
    const workspace = new AgentWorkspace(root, EXPLORE_NAME);
    const result = runExploreIntake(workspace, 'explore');
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toContain('S0 is skipped');
    expect(readAgentIntake(workspace)?.class).toBe('explorer');
    expect(baselineArmFor(workspace)).toBe('builtin_explore');
    expect(() => runExploreIntake(workspace, 'other')).toThrow(AuthoringRefusal);
    expect(() => runExploreIntake(new AgentWorkspace(root, 'code-scout'), 'explore')).toThrow(
      /only for the agent Explore/,
    );
  });

  it('registers only at pass^3 0.9 and a lower median cost than the built-in', () => {
    expect(
      exploreRegistrationProblem({ agent: metrics(0.9, 0.01), builtin: metrics(1, 0.02) }),
    ).toBeNull();
    expect(
      exploreRegistrationProblem({ agent: metrics(0.89, 0.01), builtin: metrics(1, 0.02) }),
    ).toContain('pass^3 is 0.89');
    expect(
      exploreRegistrationProblem({ agent: metrics(1, 0.02), builtin: metrics(1, 0.02) }),
    ).toContain('not lower');
    expect(exploreRegistrationProblem({ agent: undefined, builtin: undefined })).toContain(
      'no Explore',
    );
    expect(exploreRegistrationProblem({ agent: metrics(1, null), builtin: metrics(1, null) })).toBe(
      'its median cost (unavailable) is not lower than the built-in Explore (unavailable)',
    );
  });

  it('only Claude Code can override the built-in; elsewhere nothing is written and it is not deployable', () => {
    expect(hostAllowsBuiltinOverride('claude-code')).toBe(true);
    expect(hostAllowsBuiltinOverride('codex-cli')).toBe(false);
    const root = agentProject();
    const workspace = new AgentWorkspace(root, EXPLORE_NAME);
    const text = agentText({ name: EXPLORE_NAME });
    const plan = planAgentRelease({
      workspace,
      source: parseAgentSource(text),
      draftText: text,
      lint: {
        agent: EXPLORE_NAME,
        findings: [],
        blocking: 0,
        warnings: 0,
        powers: [],
        file_hash: 'h',
        hook_scripts: [],
      },
      adapters: ['claude-code', 'codex-cli'],
    });
    expect(plan.files.map((file) => file.path)).toEqual(['.claude/agents/Explore.md']);
    expect(plan.deployable).toEqual({ 'claude-code': true, 'codex-cli': false });
    expect(plan.proposals[0]).toContain('cannot override its built-in Explore');
  });

  it('onboarding on Claude Code prints one offer line naming the command', () => {
    const root = agentProject();
    mkdirSync(join(root, 'home'));
    vi.stubEnv('HOME', join(root, 'home'));
    put(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
    expect(exploreOfferLine(root)).toBe(
      'Offer: a cheaper Explore agent on the fast tier. To build and prove it, run paqad-ai agent intake Explore --preset explore.',
    );
    put(root, '.claude/agents/Explore.md', 'x');
    expect(exploreOfferLine(root)).toBeNull();
    const codex = agentProject();
    put(codex, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'codex-cli' }));
    expect(exploreOfferLine(codex)).toBeNull();
    vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', 'false');
    expect(exploreOfferLine(agentProject())).toBeNull();
  });
});
