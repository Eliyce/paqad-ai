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
import { computeRuleScriptsDigest } from '@/rule-scripts/integrity.js';
import type { RuleComplianceMode } from '@/rule-scripts/runner.js';
import { currentOrdinal } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { foldChange } from '@/stage-evidence/fold.js';
import { resolveStagesMode, type StagesMode } from '@/stage-evidence/mode.js';
import { MANDATORY_STAGES } from '@/stage-evidence/stages.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import { readCapabilityDigest } from './capability-lock.js';
import { evaluateCapabilityCompat, isRefusedByCompat } from './compat.js';
import { getCapability, type CapabilityDescriptor, type CapabilitySeam } from './registry.js';

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

/** Integrity of the rule-script bindings vs the engine-blessed lock (F5). */
type IntegrityStatus =
  // Live bindings match the blessed lock (or there is no map → nothing to verify).
  | 'ok'
  // Lock present but the live digest differs — bindings hand-edited outside the
  // engine. Their result cannot be trusted (a binding may have been weakened).
  | 'tampered'
  // Map present but no lock yet (a pre-F5 engine, or a hand-created map). The
  // bindings still run, but their integrity is not yet attested.
  | 'unverified';

/**
 * Compare the live rule-script bindings against the engine-blessed digest in the
 * capability lock (buildout F5, decision D1). Cheap and hash-only — never executes
 * a script — so it is safe on the per-edit enforcement seam.
 */
function verifyRuleScriptsIntegrity(projectRoot: string): IntegrityStatus {
  const digest = computeRuleScriptsDigest(projectRoot);
  if (digest === null) {
    return 'ok'; // No map → no bindings to verify; enforce handles the no-map case.
  }
  const locked = readCapabilityDigest(projectRoot, 'rule-scripts');
  if (locked === null) {
    return 'unverified';
  }
  return locked === digest ? 'ok' : 'tampered';
}

/** Tamper verdict: a hand-edited map cannot be trusted, so strict blocks. */
function formatTamperSummary(mode: RuleComplianceMode): string {
  const blocking = mode === 'strict';
  const verb = blocking ? 'Needs your attention' : 'Heads up';
  const glyph = blocking ? '🔴' : '🟡';
  const tail = blocking ? '' : ' (warn mode, not blocking)';
  return (
    `**▸ paqad** · scripted-rule bindings changed outside the engine\n` +
    `> ${glyph} ${verb} — your rule-script bindings were edited outside paqad, so I can't trust ` +
    `this check; a binding may have been weakened. Re-bless them with \`analyze rules\` / ` +
    `\`generate rule scripts\`, then commit the updated lock.${tail}`
  );
}

/** Advisory note: bindings run, but their integrity is not yet attested. */
function formatUnverifiedSummary(): string {
  return (
    `**▸ paqad** · scripted-rule bindings not yet attested\n` +
    `> 🟡 Heads up — your rule-script bindings have no integrity lock yet, so I can't attest ` +
    `they are unchanged. Re-run \`generate rule scripts\` to bless them. (advisory, not blocking)`
  );
}

/** Clean-refuse note (D2): this install predates the project's blessed schema, so it
 *  declines to enforce rather than misread a newer format. Never blocks. */
function formatCompatRefusalSummary(): string {
  return (
    `**▸ paqad** · scripted-rule enforcement paused — framework update pending\n` +
    `> 🟡 Heads up — this project's rule-script bindings were blessed by a newer paqad than ` +
    `the one installed here, so I'm holding off enforcing them rather than risk misreading a ` +
    `newer format. The framework self-heals on update, then I'll resume. (advisory, not blocking)`
  );
}

/**
 * The scripted-rule capability — the first contract folded into the kernel seam.
 * Wraps the already-shipped `enforceRuleScripts` (which itself fast-skips when the
 * mode is `off` or no rule-script map exists), so a strict deterministic violation
 * blocks and a warn finding surfaces but allows.
 *
 * Buildout F5 adds the integrity gate ahead of enforcement (decision D1, audit): a
 * tampered map (edited outside the engine) cannot be trusted — its "all clear" may
 * be a silent weakening — so strict blocks on tamper; an unverified map (no lock
 * yet) still enforces but surfaces an advisory so a binding is never trusted blind.
 */
const ruleScriptsCapability: Capability = {
  id: 'rule-scripts',
  async evaluate({ projectRoot, env }): Promise<CapabilityOutcome> {
    const mode = resolveRuleComplianceMode(projectRoot, env);
    if (mode === 'off') {
      return NO_OP;
    }
    // D2 (F7) — an install older than the schema the project was blessed under must
    // refuse cleanly: do not enforce a format this engine may misread. Never blocks.
    if (isRefusedByCompat(evaluateCapabilityCompat(projectRoot, getCapability('rule-scripts')))) {
      return { ran: true, blocking: false, summary: formatCompatRefusalSummary() };
    }
    const integrity = verifyRuleScriptsIntegrity(projectRoot);
    if (integrity === 'tampered') {
      // Do not run the (untrustworthy) enforcement — the tamper IS the verdict.
      return { ran: true, blocking: mode === 'strict', summary: formatTamperSummary(mode) };
    }
    const result = await enforceRuleScripts({ projectRoot, mode });
    if (!result.ran || result.violations.length === 0) {
      // No violations, but if the bindings are unverified surface that (never block).
      return integrity === 'unverified'
        ? { ran: true, blocking: false, summary: formatUnverifiedSummary() }
        : NO_OP;
    }
    return { ran: true, blocking: result.blocking, summary: result.summary };
  },
};

/**
 * Block-forward summary: the pre-development stage `stage` has no recorded
 * start+end pair, so a code edit is refused until it is run. Strict blocks; warn
 * surfaces and allows. The remediation points at the recorder verbs (via se-mark,
 * a Bash script the PreToolUse matcher does NOT gate — the non-wedging escape hatch).
 */
function formatMissingStageSummary(stage: string, mode: StagesMode): string {
  const blocking = mode === 'strict';
  const verb = blocking ? 'Needs your attention' : 'Heads up';
  const glyph = blocking ? '🔴' : '🟡';
  const tail = blocking ? '' : ' (warn mode, not blocking)';
  return (
    `**▸ paqad** · run ${stage} before you change code\n` +
    `> ${glyph} ${verb} — the feature-development workflow needs the **${stage}** stage recorded ` +
    `before this edit. Mark it: \`SE_SESSION= npx tsx scripts/se-mark.ts start ${stage}\` then ` +
    `\`… end ${stage}\` (or emit the \`paqad:stage ${stage} start\`/\`end\` markers). Set ` +
    `stages_mode=warn/off in .paqad/configs/.config.policy to adopt the workflow before ` +
    `enforcing.${tail}`
  );
}

/**
 * Feature-development stages — block-forward (RCA fix B). At the pre-mutation seam,
 * refuse a code edit until every MANDATORY stage that precedes `development`
 * (planning, specification) carries a recorded start+end pair in the stage-evidence
 * ledger. `development` IS the edit; review/checks/documentation_sync are
 * post-development and stay on the completion (finalize/verify) path, so the impl
 * no-ops at the completion seam (no double-fire). Reads the LEDGER, never a git
 * delta, so it is structurally immune to the committed-clean-tree nullifier that
 * guts the Stop path (R3/R6).
 */
const stagesCapability: Capability = {
  id: 'stages',
  async evaluate({ projectRoot, seam, env }): Promise<CapabilityOutcome> {
    if (seam !== 'pre-mutation') return NO_OP;
    const mode = resolveStagesMode(projectRoot, env);
    if (mode === 'off') return NO_OP;
    const blocking = mode === 'strict';

    const sessionId = resolveSessionId(projectRoot, env.CLAUDE_SESSION_ID ?? null);
    const ordinal = currentOrdinal(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId);

    // The mandatory stages that must exist BEFORE code is written.
    const prefix = MANDATORY_STAGES.slice(0, MANDATORY_STAGES.indexOf('development'));

    if (ordinal <= 0) {
      // No change opened yet → the first required stage is missing.
      return {
        ran: true,
        blocking,
        summary: formatMissingStageSummary(prefix[0] ?? 'planning', mode),
      };
    }

    const fold = foldChange(projectRoot, sessionId, ordinal);
    const byStage = new Map(fold.stages.map((stage) => [stage.stage, stage]));
    for (const stage of prefix) {
      const folded = byStage.get(stage);
      const hasPair = Boolean(folded?.started_at && folded?.ended_at);
      if (!hasPair) {
        return { ran: true, blocking, summary: formatMissingStageSummary(stage, mode) };
      }
    }
    // planning + specification recorded — allow (this edit IS development).
    return NO_OP;
  },
};

/**
 * The capabilities CURRENTLY executing through the kernel seam, keyed by id. The
 * gate runs only descriptors present here; a registry row without an impl stays on
 * its legacy path until a later slice folds it in (and removes that path).
 */
export const CAPABILITY_IMPLS: ReadonlyMap<CapabilityDescriptor['id'], Capability> = new Map([
  [ruleScriptsCapability.id, ruleScriptsCapability],
  [stagesCapability.id, stagesCapability],
]);
