// Evidence-existence-gate mode (issue #468 Phase C).
//
// A warn-only completion check that the active feature bundle carries its four evidence
// files (rule-run / duplication / change-metrics / rag). It has deliberately NO `strict`
// tier — the #310/#394/pre-mutation false-block history is the reason this class of
// completion check never gets teeth. `off` disables it; `warn` (the default) surfaces a
// gap without ever blocking the exit.
//
// Like the other enforced-mode knobs it is FLOORED: the team-tracked `configs/.config.*`
// value is a floor, and the local `.paqad/.config` / `PAQAD_EVIDENCE_EXISTENCE_GATE` env
// may only RAISE it (off → warn), never lower it — a lone developer cannot silently turn
// the check off when the team committed `warn` (decision D1, the C2 clamp). It is a
// registered FRAMEWORK_CONFIG_SPEC, so its doc line ships in the team config files.

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type EvidenceExistenceMode = 'off' | 'warn';

/** Modes weakest → strictest, for the floor clamp (no `strict` — warn is the ceiling). */
export const EVIDENCE_EXISTENCE_MODES = ['off', 'warn'] as const;

/** Default: warn — the check surfaces a gap out of the box, but never blocks. */
export const DEFAULT_EVIDENCE_EXISTENCE_MODE: EvidenceExistenceMode = 'warn';

/**
 * Resolve the evidence-existence-gate mode with the team value as a floor. The tracked
 * `configs/.config.*` value is the floor; the local `.config` and the
 * `PAQAD_EVIDENCE_EXISTENCE_GATE` env may only RAISE it (off → warn). With nothing set the
 * `warn` default applies (and is itself the floor), so the check is on by default and a lone
 * developer cannot disable it locally — only a team commit can (decision D1).
 */
export function resolveEvidenceExistenceMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): EvidenceExistenceMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('evidence_existence_gate'),
      local: readDotConfig(projectRoot).get('evidence_existence_gate'),
      env: env.PAQAD_EVIDENCE_EXISTENCE_GATE,
    },
    EVIDENCE_EXISTENCE_MODES,
    DEFAULT_EVIDENCE_EXISTENCE_MODE,
  );
}
