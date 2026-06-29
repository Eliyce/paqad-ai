// Capability executors (buildout F3 — the kernel seam behaviour).
//
// `registry.ts` holds the metadata (the CapabilityDescriptor rows). This file
// holds the BEHAVIOUR: each capability's `evaluate()` — a no-LLM, working-tree
// scan that returns a block/allow outcome — wrapping the leaf logic that already
// shipped. The executor (`gate.ts`) iterates the registry at a host seam and runs
// each capability's evaluate, so the five contracts bind through ONE host hook
// instead of five bespoke ones.
//
// CAPABILITY_IMPLS is the set of capabilities CURRENTLY bound through the kernel
// seam. It grows one entry at a time as each contract is folded in (and its
// legacy path removed) — never a double-fire. Today only `rule-scripts` is folded
// in (it already bound through rule-script-enforce.mjs, now replaced); stages and
// delivery still bind through the completion verification run, decision-pause
// through its own gate, until F6 folds them here.

import { resolveFlooredMode } from '@/core/floored-mode.js';
import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { enforceRuleScripts } from '@/rule-scripts/enforce.js';
import type { RuleComplianceMode } from '@/rule-scripts/runner.js';

import type { CapabilityDescriptor, CapabilitySeam } from './registry.js';

/** What a capability sees when it evaluates at a host seam. */
export interface CapabilityContext {
  projectRoot: string;
  /** The host lifecycle point being evaluated. */
  seam: CapabilitySeam;
  env: NodeJS.ProcessEnv;
}

/** A capability's block/allow decision for one evaluation. */
export interface CapabilityOutcome {
  /** True when the capability actually did work (a non-skip evaluation). */
  ran: boolean;
  /** True when the finding must STOP the host (strict violation). */
  blocking: boolean;
  /** paqad-voice summary of the finding, or empty when nothing to report. */
  summary: string;
}

/** A neutral, no-work outcome — the common fast-skip result. */
const NO_OP: CapabilityOutcome = { ran: false, blocking: false, summary: '' };

/** One unified contract. The descriptor (registry.ts) carries the metadata; this
 *  carries the behaviour. `evaluate` is the only method the F3 seam needs;
 *  record/migrate join the interface as F6/F7 fold those concerns in. */
export interface Capability {
  id: CapabilityDescriptor['id'];
  /** Run the no-LLM working-tree scan and decide block/allow. Must never throw on
   *  an ordinary "nothing to enforce" — return NO_OP. Infra errors propagate to
   *  the gate, which soft-fails so a broken install never wedges the agent. */
  evaluate(context: CapabilityContext): Promise<CapabilityOutcome>;
}

/** rule_compliance modes, weakest → strictest (mirrors the FRAMEWORK_CONFIG_SPEC
 *  enum). The team value is a FLOOR; local/env may only RAISE (the C2 clamp). */
const RULE_COMPLIANCE_MODES = ['off', 'warn', 'strict'] as const;
const DEFAULT_RULE_COMPLIANCE: RuleComplianceMode = 'warn';

/**
 * Resolve the floored `rule_compliance` mode (the same clamp `stages_mode` uses):
 * the tracked `configs/.config.*` value is the floor; the local `.config` and the
 * `PAQAD_RULE_COMPLIANCE` env may only raise strictness above it.
 */
export function resolveRuleComplianceMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): RuleComplianceMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('rule_compliance'),
      local: readDotConfig(projectRoot).get('rule_compliance'),
      env: env.PAQAD_RULE_COMPLIANCE,
    },
    RULE_COMPLIANCE_MODES,
    DEFAULT_RULE_COMPLIANCE,
  );
}

/**
 * The scripted-rule capability — the first contract folded into the kernel seam.
 * Wraps the already-shipped `enforceRuleScripts` (which itself fast-skips when the
 * mode is `off` or no rule-script map exists), so behaviour is identical to the
 * retired rule-script-enforce.mjs: a strict deterministic violation blocks; a warn
 * finding surfaces but allows.
 */
const ruleScriptsCapability: Capability = {
  id: 'rule-scripts',
  async evaluate({ projectRoot, env }): Promise<CapabilityOutcome> {
    const mode = resolveRuleComplianceMode(projectRoot, env);
    const result = await enforceRuleScripts({ projectRoot, mode });
    if (!result.ran || result.violations.length === 0) {
      return NO_OP;
    }
    return { ran: true, blocking: result.blocking, summary: result.summary };
  },
};

/**
 * The capabilities CURRENTLY executing through the kernel seam, keyed by id. The
 * gate runs only descriptors present here; a registry row without an impl stays on
 * its legacy path until a later slice folds it in (and removes that path).
 */
export const CAPABILITY_IMPLS: ReadonlyMap<CapabilityDescriptor['id'], Capability> = new Map([
  [ruleScriptsCapability.id, ruleScriptsCapability],
]);
