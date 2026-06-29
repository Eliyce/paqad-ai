// Stage-evidence enforcement mode (buildout F4 — the RCA closure).
//
// The stage-completeness gate used to hard-fail only when `result.live_marked`
// was true, but the only writers of a live-mark (startStage/endStage) have no
// production caller, so live_marked was ALWAYS false and the gate silently
// downgraded every incomplete change to `skipped` — `verdict.ok` stayed true and
// a `cannot-verify` change shipped anyway (the verified smoking gun). This knob
// replaces that dead condition: in `strict` (the default, decision D3) an
// incomplete change at a local origin FAILS regardless of live_marked.
//
// `stages_mode` is read here like `rule_compliance` is in rule-script-enforce.mjs:
// a hook/enforcement-layer mode knob, NOT yet a registered FRAMEWORK_CONFIG_SPEC.
// Buildout F2 (the C2 clamp) registers BOTH stages_mode and rule_compliance as
// floored capability-mode knobs — fixing their config-prune gap and making the
// resolved mode `max(team-floor, local)` so a project can only RAISE strictness.

import { layeredConfigMap } from '@/core/framework-config.js';

export type StagesMode = 'off' | 'warn' | 'strict';

/** Decision D3: strict by default — the gate has teeth out of the box. */
export const DEFAULT_STAGES_MODE: StagesMode = 'strict';

/**
 * Resolve the stage-evidence mode for a project. Precedence: `PAQAD_STAGES_MODE`
 * env (per-run escape hatch) > layered config (`.config` / `configs/.config.*`) >
 * the strict default. An unrecognised value resolves to the strict default rather
 * than silently disabling the gate.
 */
export function resolveStagesMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): StagesMode {
  const fromEnv = env.PAQAD_STAGES_MODE?.trim().toLowerCase();
  const fromConfig = layeredConfigMap(projectRoot, env).get('stages_mode')?.trim().toLowerCase();
  const raw = fromEnv || fromConfig;
  return raw === 'off' || raw === 'warn' ? raw : DEFAULT_STAGES_MODE;
}
