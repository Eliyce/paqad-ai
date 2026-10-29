import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import type { AgentRole } from '@/core/types/agent.js';
import type { Lane } from '@/core/types/routing.js';
import {
  layeredConfigMap,
  resolveNumericConfig,
  resolveSpecPipelineSwitches,
  type SpecPipelineAdoptionMode,
} from '@/core/framework-config.js';
import { DEFAULT_STANDING_EXPERTS, isExpertRole } from './experts/roster.js';

export type GateMode = 'off' | 'warn' | 'strict';

const GATE_MODES: readonly GateMode[] = ['off', 'warn', 'strict'];

export type AdoptionMode = SpecPipelineAdoptionMode;

export const DEFAULT_TOKEN_CEILING = 40000;

export const DEFAULT_GROUNDING_BUDGET_MS = 15000;

export interface PipelineConfig {
  enabled: boolean;
  clarification: GateMode;
  final_review: GateMode;
  token_ceiling: number;
  grounding_budget_ms: number;
  experts_enabled: boolean;
  adoption: AdoptionMode;
  standing_experts: AgentRole[];
  standing_experts_dropped: string[];
  experts_lanes: Lane[];
}

function asGateMode(raw: string | undefined, fallback: GateMode): GateMode {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  return (GATE_MODES as readonly string[]).includes(v) ? (v as GateMode) : fallback;
}

export function parseStandingExperts(raw: string | undefined): {
  standing_experts: AgentRole[];
  standing_experts_dropped: string[];
} {
  if (raw === undefined) {
    return { standing_experts: [...DEFAULT_STANDING_EXPERTS], standing_experts_dropped: [] };
  }
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const standing_experts: AgentRole[] = [];
  const standing_experts_dropped: string[] = [];
  for (const part of parts) {
    if (!isExpertRole(part)) {
      if (!standing_experts_dropped.includes(part)) standing_experts_dropped.push(part);
      continue;
    }
    if (!standing_experts.includes(part)) standing_experts.push(part);
  }
  return { standing_experts, standing_experts_dropped };
}

export function readPipelineConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): PipelineConfig {
  const map = layeredConfigMap(projectRoot, env);
  const switches = resolveSpecPipelineSwitches(map);
  const standing = parseStandingExperts(map.get('spec_pipeline_standing_experts'));
  return {
    enabled: switches.enabled,
    clarification: asGateMode(map.get('spec_pipeline_clarification'), 'warn'),
    final_review: asGateMode(map.get('spec_pipeline_final_review'), 'off'),
    token_ceiling: resolveNumericConfig(
      projectRoot,
      env,
      'spec_pipeline_token_ceiling',
      DEFAULT_TOKEN_CEILING,
      (n) => n > 0,
    ),
    grounding_budget_ms: resolveNumericConfig(
      projectRoot,
      env,
      'spec_grounding_budget_ms',
      DEFAULT_GROUNDING_BUDGET_MS,
      (n) => n > 0,
    ),
    experts_enabled: switches.experts_enabled,
    adoption: switches.adoption,
    standing_experts: standing.standing_experts,
    standing_experts_dropped: standing.standing_experts_dropped,
    experts_lanes: switches.experts_lanes,
  };
}

export function expertsActive(config: PipelineConfig): boolean {
  return config.enabled && config.experts_enabled;
}

export function standingBudgetSum(config: PipelineConfig): number {
  return config.standing_experts.reduce((sum, role) => sum + (ROLE_TOKEN_BUDGETS[role] ?? 0), 0);
}
