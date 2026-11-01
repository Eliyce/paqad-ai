import { existsSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { resolveFrameworkConfig } from '@/core/framework-config.js';

import { agentOrchestratorEnabled } from './config.js';
import type { AgentArmMetrics } from './eval/passk.js';
import { enabledAdapters } from './paths.js';
import { runAgentIntake } from './stages/agent-intake.js';
import type { StageResult } from './stages/result.js';
import { meetsThreshold } from './thresholds.js';
import {
  AuthoringRefusal,
  renderGateMarkdown,
  stageById,
  stageState,
  type AuthoringWorkspace,
} from './workspace.js';

export const EXPLORE_NAME = 'Explore';
export const EXPLORE_PRESET_KEY = 'explore';
export const EXPLORE_PASS_K_MIN = 0.9;
export const EXPLORE_MAX_TURNS = 30;
export const EXPLORE_REPORT_MAX_TOKENS = 2000;
export const BUILTIN_OVERRIDE_HOSTS: readonly string[] = ['claude-code'];

export function hostAllowsBuiltinOverride(host: string): boolean {
  return BUILTIN_OVERRIDE_HOSTS.includes(host);
}

export function explorePreset(projectRoot: string): Record<string, unknown> {
  return {
    job: 'Find the files, symbols and facts a task needs in this codebase and say where they are, without changing anything.',
    delegation_brief:
      'The question to answer, the area of the codebase to search and what the caller will do with the answer.',
    report: { template: 'Files, Findings, Status', max_tokens: EXPLORE_REPORT_MAX_TOKENS },
    tools: ['Read', 'Grep', 'Glob'],
    model_tier: 'fast',
    model: resolveFrameworkConfig(projectRoot).model_routing.fast_model,
    effort: 'low',
    stopping: {
      max_turns: EXPLORE_MAX_TURNS,
      done_when: 'every part of the question has a file and line, or is named as not found',
      when_blocked: 'return BLOCKED with the question that needs the caller',
    },
    memory: 'none',
    isolation: 'none',
    parallel: false,
    cache_ttl: '5m',
    class: 'explorer',
    invocation: 'auto',
    pattern: 'single-call',
    omit_claude_md: true,
    baseline_arm: 'builtin_explore',
  };
}

export function explorePresetText(projectRoot: string): string {
  return YAML.stringify(explorePreset(projectRoot));
}

export function exploreRegistrationProblem(input: {
  agent: AgentArmMetrics | undefined;
  builtin: AgentArmMetrics | undefined;
}): string | null {
  if (input.agent === undefined || input.builtin === undefined) {
    return 'the S5 benchmark has no Explore and built-in Explore numbers to compare';
  }
  if (!meetsThreshold(input.agent.pass_hat_k, EXPLORE_PASS_K_MIN)) {
    return `pass^3 is ${input.agent.pass_hat_k}; the Explore override needs ${EXPLORE_PASS_K_MIN}`;
  }
  if (
    input.agent.cost_median === null ||
    input.builtin.cost_median === null ||
    !(input.agent.cost_median < input.builtin.cost_median)
  ) {
    return `its median cost (${input.agent.cost_median ?? 'unavailable'}) is not lower than the built-in Explore (${input.builtin.cost_median ?? 'unavailable'})`;
  }
  return null;
}

export function exploreOfferLine(projectRoot: string): string | null {
  if (!agentOrchestratorEnabled(projectRoot)) return null;
  if (!enabledAdapters(projectRoot).some((adapter) => hostAllowsBuiltinOverride(adapter))) {
    return null;
  }
  if (existsSync(join(projectRoot, '.claude/agents', `${EXPLORE_NAME}.md`))) return null;
  return `Offer: a cheaper Explore agent on the fast tier. To build and prove it, run paqad-ai agent intake ${EXPLORE_NAME} --preset ${EXPLORE_PRESET_KEY}.`;
}

export function runExploreIntake(workspace: AuthoringWorkspace, preset: string): StageResult {
  if (preset !== EXPLORE_PRESET_KEY) {
    throw new AuthoringRefusal(`--preset knows only ${EXPLORE_PRESET_KEY}.`, 2);
  }
  if (workspace.name !== EXPLORE_NAME) {
    throw new AuthoringRefusal(
      `--preset ${EXPLORE_PRESET_KEY} is only for the agent ${EXPLORE_NAME}.`,
      2,
    );
  }
  const lines: string[] = [];
  if (stageState(workspace, stageById('S0', workspace.stages)).state === 'not-run') {
    workspace.write(
      'justification.md',
      renderGateMarkdown(
        {
          gate: 'skipped',
          stage: 'S0',
          reason:
            'the Explore preset overrides the built-in Explore, which S5 runs as the baseline',
        },
        `# Justification: ${EXPLORE_NAME}\n\nThe built-in Explore already does this job; the override is kept only if S5 proves it at pass^3 ${EXPLORE_PASS_K_MIN} for a lower median cost.\n`,
      ),
    );
    lines.push('S0 is skipped: the built-in Explore is the S5 baseline.');
  }
  const result = runAgentIntake(workspace, explorePresetText(workspace.projectRoot));
  return { ...result, lines: [...lines, ...result.lines] };
}
