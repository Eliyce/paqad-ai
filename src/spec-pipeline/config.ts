// Spec-pipeline enforcement config reader (issue #512, FR-1.5 / B.3).
//
// Reads the four spec_pipeline_* knobs from the layered (LOCAL-WINS) config, deterministically
// and with graceful fallback (a hand-trimmed value degrades to the documented default, never
// throws — RULE-16). The resolved snapshot is recorded with every run so a run's provenance
// is honest about which gates were on.

import { layeredConfigMap, resolveNumericConfig } from '@/core/framework-config.js';

/** A switchable gate level (issue #512 B.3): off | advisory (warn) | required (strict). */
export type GateMode = 'off' | 'warn' | 'strict';

const GATE_MODES: readonly GateMode[] = ['off', 'warn', 'strict'];
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export interface PipelineConfig {
  /** Master switch. Off by default ⇒ feature-development is byte-identical to today (FR-11). */
  enabled: boolean;
  /** The switchable clarification (question-round) gate. */
  clarification: GateMode;
  /** The switchable final-review gate before freeze. */
  final_review: GateMode;
  /** Per-run model-token ceiling; exceeding it is a recorded warning, never a block. */
  token_ceiling: number;
}

function asGateMode(raw: string | undefined, fallback: GateMode): GateMode {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  return (GATE_MODES as readonly string[]).includes(v) ? (v as GateMode) : fallback;
}

/** Resolve the spec-pipeline config snapshot for a project. Pure read; zero model tokens. */
export function readPipelineConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): PipelineConfig {
  const map = layeredConfigMap(projectRoot, env);
  const enabledRaw = map.get('spec_pipeline_enabled');
  return {
    enabled: enabledRaw !== undefined && TRUTHY.has(enabledRaw.trim().toLowerCase()),
    clarification: asGateMode(map.get('spec_pipeline_clarification'), 'warn'),
    final_review: asGateMode(map.get('spec_pipeline_final_review'), 'off'),
    token_ceiling: resolveNumericConfig(
      projectRoot,
      env,
      'spec_pipeline_token_ceiling',
      20000,
      (n) => n > 0,
    ),
  };
}
