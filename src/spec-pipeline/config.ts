// Spec-pipeline enforcement config reader (issue #512, FR-1.5 / B.3; extended by #558).
//
// Reads the spec_pipeline_* knobs from the layered (LOCAL-WINS) config, deterministically
// and with graceful fallback (a hand-trimmed value degrades to the documented default, never
// throws — RULE-16). The resolved snapshot is recorded with every run so a run's provenance
// is honest about which gates were on.

import { ROLE_TOKEN_BUDGETS } from '@/core/constants/budgets.js';
import type { AgentRole } from '@/core/types/agent.js';
import { layeredConfigMap, resolveNumericConfig } from '@/core/framework-config.js';
import { DEFAULT_STANDING_EXPERTS, isExpertRole } from './experts/roster.js';

/** A switchable gate level (issue #512 B.3): off | advisory (warn) | required (strict). */
export type GateMode = 'off' | 'warn' | 'strict';

const GATE_MODES: readonly GateMode[] = ['off', 'warn', 'strict'];
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * How firmly the specification stage adopts the pipeline once it is enabled (issue #547, FR-1.1):
 * `warn` (default) tells the agent to use the pipeline but still freezes a hand-written spec,
 * recording `pipeline.produced=false`; `strict` refuses a non-pipeline spec at freeze unless
 * `--manual --reason` is given. No effect while the pipeline is off.
 */
export type AdoptionMode = 'warn' | 'strict';

const ADOPTION_MODES: readonly AdoptionMode[] = ['warn', 'strict'];

/** The default onboarded per-run token ceiling (issue #558 raised it to fit four standing budgets). */
export const DEFAULT_TOKEN_CEILING = 40000;

export interface PipelineConfig {
  /** Master switch. Off by default ⇒ feature-development is byte-identical to today (FR-11). */
  enabled: boolean;
  /** The switchable clarification (question-round) gate. */
  clarification: GateMode;
  /** The switchable final-review gate before freeze. */
  final_review: GateMode;
  /** Per-run model-token ceiling; exceeding it is a recorded warning, never a block. */
  token_ceiling: number;
  /**
   * Phase 2 expert roster (issue #521). Off by default ⇒ zero Phase 2 code runs and a run is
   * byte-identical to v1 (P2-INV-1). Only meaningful when {@link PipelineConfig.enabled} is on.
   */
  experts_enabled: boolean;
  /**
   * How firmly the specification stage adopts the pipeline (issue #547). `warn` by default; only
   * meaningful when {@link PipelineConfig.enabled} is on.
   */
  adoption: AdoptionMode;
  /**
   * The experts that sit at the table on every run (issue #558). Defaults to the four
   * {@link DEFAULT_STANDING_EXPERTS}; a team may override with `spec_pipeline_standing_experts`.
   * Unknown or non-expert ids are dropped (see {@link PipelineConfig.standing_experts_dropped}).
   * An empty string means no standing experts — the detector alone decides, as before.
   */
  standing_experts: AgentRole[];
  /** The ids in the knob that were dropped because they are not expert roles (the recorded warning). */
  standing_experts_dropped: string[];
}

function asGateMode(raw: string | undefined, fallback: GateMode): GateMode {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  return (GATE_MODES as readonly string[]).includes(v) ? (v as GateMode) : fallback;
}

function asAdoptionMode(raw: string | undefined, fallback: AdoptionMode): AdoptionMode {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  return (ADOPTION_MODES as readonly string[]).includes(v) ? (v as AdoptionMode) : fallback;
}

/**
 * Parse the `spec_pipeline_standing_experts` knob into a deduped list of valid expert roles,
 * plus the ids that were dropped for not being expert roles. `undefined` (knob unset) falls back
 * to the four defaults; an empty or whitespace-only string means no standing experts. Deterministic
 * and model-free (INV-4).
 */
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

/** Resolve the spec-pipeline config snapshot for a project. Pure read; zero model tokens. */
export function readPipelineConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): PipelineConfig {
  const map = layeredConfigMap(projectRoot, env);
  const enabledRaw = map.get('spec_pipeline_enabled');
  const expertsRaw = map.get('spec_pipeline_experts_enabled');
  const standing = parseStandingExperts(map.get('spec_pipeline_standing_experts'));
  return {
    enabled: enabledRaw !== undefined && TRUTHY.has(enabledRaw.trim().toLowerCase()),
    clarification: asGateMode(map.get('spec_pipeline_clarification'), 'warn'),
    final_review: asGateMode(map.get('spec_pipeline_final_review'), 'off'),
    token_ceiling: resolveNumericConfig(
      projectRoot,
      env,
      'spec_pipeline_token_ceiling',
      DEFAULT_TOKEN_CEILING,
      (n) => n > 0,
    ),
    experts_enabled: expertsRaw !== undefined && TRUTHY.has(expertsRaw.trim().toLowerCase()),
    adoption: asAdoptionMode(map.get('spec_pipeline_adoption'), 'warn'),
    standing_experts: standing.standing_experts,
    standing_experts_dropped: standing.standing_experts_dropped,
  };
}

/**
 * Whether the Phase 2 expert roster is active (issue #521): the master pipeline switch AND the
 * experts flag both on. A single canonical gate so no caller re-derives the "both on" rule — an
 * experts flag set while the pipeline itself is off must never run Phase 2 code (P2-INV-1).
 */
export function expertsActive(config: PipelineConfig): boolean {
  return config.enabled && config.experts_enabled;
}

/** The sum of the granted budgets for the resolved standing experts (issue #558, doctor + ceiling). */
export function standingBudgetSum(config: PipelineConfig): number {
  return config.standing_experts.reduce((sum, role) => sum + (ROLE_TOKEN_BUDGETS[role] ?? 0), 0);
}
