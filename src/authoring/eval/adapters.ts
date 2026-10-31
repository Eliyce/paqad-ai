import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import type { AdapterType } from '@/core/types/adapter.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';
import { versionAtLeast } from '@/core/version-compare.js';
import { defaultClaudeVersion } from '@/install/plugin-migration.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';
import { isSubagentCapableAdapter } from '@/stage-isolation/stage-agents.js';

import { CLAUDE_PLUGIN_EVAL_SUPPORT } from '../lint/fields.js';

export type EvalAdapter = 'claude-plugin-eval' | 'subagent-dispatch' | 'none';

export interface EvalAdapterChoice {
  adapter: EvalAdapter;
  host: string;
  claude_version: string | null;
  reason: string;
}

export function selectEvalAdapter(input: {
  host: string;
  claudeVersion: string | null;
}): EvalAdapterChoice {
  const base = { host: input.host, claude_version: input.claudeVersion };
  if (input.host === 'claude-code') {
    if (
      input.claudeVersion !== null &&
      versionAtLeast(input.claudeVersion, CLAUDE_PLUGIN_EVAL_SUPPORT.minimum_version)
    ) {
      return {
        ...base,
        adapter: 'claude-plugin-eval',
        reason: `Claude Code ${input.claudeVersion} has claude plugin eval`,
      };
    }
    return {
      ...base,
      adapter: 'subagent-dispatch',
      reason:
        input.claudeVersion === null
          ? 'the installed Claude Code version could not be read'
          : `Claude Code ${input.claudeVersion} is older than ${CLAUDE_PLUGIN_EVAL_SUPPORT.minimum_version}`,
    };
  }
  if (isSubagentCapableAdapter(input.host, STAGE_AGENT_HOSTS)) {
    return {
      ...base,
      adapter: 'subagent-dispatch',
      reason: `${input.host} can dispatch subagents`,
    };
  }
  return {
    ...base,
    adapter: 'none',
    reason: `${input.host} has no subagents, so the skill can only be self-tested`,
  };
}

export function activeHost(projectRoot: string): AdapterType | string {
  try {
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, PATHS.ONBOARDING_MANIFEST), 'utf8'),
    ) as Partial<OnboardingManifest>;
    return typeof manifest.adapter === 'string' ? manifest.adapter : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function chooseEvalAdapter(
  projectRoot: string,
  probe: () => string | null = defaultClaudeVersion,
): EvalAdapterChoice {
  const host = activeHost(projectRoot);
  return selectEvalAdapter({ host, claudeVersion: host === 'claude-code' ? probe() : null });
}

export interface EvalTier {
  tier: 'fast' | 'reasoning';
  model: string;
}

export function evalTiers(projectRoot: string): EvalTier[] {
  const routing = resolveFrameworkConfig(projectRoot).model_routing;
  return [
    { tier: 'fast', model: routing.fast_model },
    { tier: 'reasoning', model: routing.reasoning_model },
  ];
}
