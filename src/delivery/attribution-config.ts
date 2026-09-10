// Host-agent AI attribution policy (issue #538).
//
// A coding agent writes its own vendor's attribution into the change it produces: Claude Code
// adds a `Co-Authored-By` trailer to the commit and an attribution line to the PR body, Cursor
// adds a "Made with Cursor" trailer, and so on. That trailer is what makes a git host list the
// AI vendor as a CONTRIBUTOR on the repository, which is the part an enterprise buyer rejects.
//
// One knob decides the posture, registered in FRAMEWORK_CONFIG_SPECS so it is discoverable in
// the team config files (RULE-16):
//   - ai_attribution — keep | strip, a FLOORED capability mode (like duplication_mode and
//     rule_compliance): the team value is a floor, local/env may only RAISE it. Default `strip`
//     (resolved decision D-01M259168CYT2Y6MJF6V3B777W): an enterprise should get clean history
//     out of the box rather than having to discover a setting.
//
// Scope note, deliberate: this knob targets the HOST AGENT's attribution only. paqad's own
// delivery footer stays (resolved decision D-01M2591H8DFAD1AK6JG1SFZWYV) — paqad is the
// customer's own governance tool, not a third-party AI vendor, and that footer is a feature
// they bought. The marker table in ./ai-attribution.js must never match it (INV-2).

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type AiAttributionMode = 'keep' | 'strip';

/** Modes weakest → strictest, for the floor clamp. */
export const AI_ATTRIBUTION_MODES = ['keep', 'strip'] as const;

/** Strip by default — the enterprise posture, not an opt-in (issue #538). */
export const DEFAULT_AI_ATTRIBUTION_MODE: AiAttributionMode = 'strip';

/**
 * Resolve `ai_attribution` with the team value as a floor. A team that commits `strip` to
 * `configs/.config.policy` cannot have it lowered by a developer's git-ignored `.paqad/.config`
 * or a `PAQAD_AI_ATTRIBUTION` env var; those layers may only raise it. Lowering the posture
 * takes a visible, reviewable team commit — the same trust model as every other floored knob.
 */
export function resolveAiAttributionMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AiAttributionMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('ai_attribution'),
      local: readDotConfig(projectRoot).get('ai_attribution'),
      env: env.PAQAD_AI_ATTRIBUTION,
    },
    AI_ATTRIBUTION_MODES,
    DEFAULT_AI_ATTRIBUTION_MODE,
  );
}

/** True when paqad should actively suppress host-agent attribution for this project. */
export function shouldStripAiAttribution(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveAiAttributionMode(projectRoot, env) === 'strip';
}
