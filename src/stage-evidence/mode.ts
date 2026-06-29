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
// `stages_mode` is an ENFORCED capability-mode knob (buildout F2): the team value
// is a floor and the local `.config` / `PAQAD_STAGES_MODE` env may only RAISE
// strictness, never lower it (the C2 clamp, decision D1). It is a registered
// FRAMEWORK_CONFIG_SPEC, so it is discoverable in the team config files and never
// pruned. The same clamp applies to `rule_compliance` in rule-script-enforce.mjs.

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type StagesMode = 'off' | 'warn' | 'strict';

/** Modes weakest → strictest, for the floor clamp. */
export const STAGES_MODES = ['off', 'warn', 'strict'] as const;

/** Decision D3: strict by default — the gate has teeth out of the box. */
export const DEFAULT_STAGES_MODE: StagesMode = 'strict';

/**
 * Resolve the stage-evidence mode for a project with the team value as a floor.
 * The tracked `configs/.config.*` value is the floor; the local `.config` and the
 * `PAQAD_STAGES_MODE` env may only RAISE strictness above it. With nothing set the
 * strict default applies (and is itself the floor), so a lone developer cannot
 * disable the gate locally — only a team commit can lower it (decision D1).
 */
export function resolveStagesMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): StagesMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('stages_mode'),
      local: readDotConfig(projectRoot).get('stages_mode'),
      env: env.PAQAD_STAGES_MODE,
    },
    STAGES_MODES,
    DEFAULT_STAGES_MODE,
  );
}
