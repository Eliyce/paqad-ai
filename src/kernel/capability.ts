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

import { readFileSync } from 'node:fs';

import { resolveFlooredMode } from '@/core/floored-mode.js';
import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { readProjectRuleComplianceModeOverride } from '@/pipeline/feature-development-policy.js';
import { execaCommandRunner, runDeliveryCapability } from '@/delivery/delivery-check.js';
import { runDecisionSelfArm } from '@/planning/decision-selfarm.js';
import { runSpecChangeGuard } from '@/spec/spec-change-guard.js';
import { enforceRuleScripts } from '@/rule-scripts/enforce.js';
import { computeRuleScriptsDigest } from '@/rule-scripts/integrity.js';
import type { RuleComplianceMode } from '@/rule-scripts/runner.js';
import { currentOrdinal } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { foldChange } from '@/stage-evidence/fold.js';
import { parseAndRecordMarkers } from '@/stage-evidence/marker-parse.js';
import { markerBatchNarration } from '@/stage-evidence/narration.js';
import { resolveStagesMode, type StagesMode } from '@/stage-evidence/mode.js';
import { isFeatureDevEdit } from '@/stage-evidence/scope.js';
import { isArtifactBearingStage, PRE_CODE_STAGES } from '@/stage-evidence/stages.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import { readCapabilityDigest } from './capability-lock.js';
import { evaluateCapabilityCompat, isRefusedByCompat } from './compat.js';
import {
  getCapability,
  type CapabilityDescriptor,
  type CapabilityPayload,
  type CapabilitySeam,
} from './registry.js';

/** What a capability sees when it evaluates at a host seam. */
export interface CapabilityContext {
  projectRoot: string;
  /** The host lifecycle point being evaluated. */
  seam: CapabilitySeam;
  env: NodeJS.ProcessEnv;
  /** The host tool/turn payload, when the seam parsed one from stdin. Most
   *  capabilities ignore it; the decision-pause self-arm reads it. */
  payload?: CapabilityPayload;
}

/** A capability's block/allow decision for one evaluation. */
export interface CapabilityOutcome {
  /** True when the capability actually did work (a non-skip evaluation). */
  ran: boolean;
  /** True when the finding must STOP the host (strict violation). */
  blocking: boolean;
  /** paqad-voice summary of the finding, or empty when nothing to report. */
  summary: string;
  /** User-visible `▸ paqad` narration for work done as a side effect of the
   *  evaluation (e.g. stage markers recorded to the ledger), independent of the
   *  block/allow verdict. Narration and ledger are both non-negotiable (issue
   *  #307): a ledger write must never be silent, so the host surfaces this via
   *  its user-message channel even when nothing blocks. */
  narration?: string;
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
 * the tracked value is the floor; the local `.config` and the
 * `PAQAD_RULE_COMPLIANCE` env may only raise strictness above it.
 *
 * Issue #319 — the workflow yaml's `checks.rule_compliance.mode` is now a REAL
 * input, not a placebo. It used to be read into the policy object and ignored here
 * (the resolver looked only at `.config`), so a team that set `strict` in
 * `feature-development.yaml` silently got the `warn` default. Both surfaces are
 * team-tracked, so the floor is the STRICTER of the two — a team asking for strict
 * on either surface gets strict, and lowering below the floor still requires a
 * visible, committed change (never a silent local override).
 */
export function resolveRuleComplianceMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): RuleComplianceMode {
  return resolveFlooredMode(
    {
      team: stricterTeamFloor(
        readConfigsDir(projectRoot).merged.get('rule_compliance'),
        readProjectRuleComplianceModeOverride(projectRoot),
      ),
      local: readDotConfig(projectRoot).get('rule_compliance'),
      env: env.PAQAD_RULE_COMPLIANCE,
    },
    RULE_COMPLIANCE_MODES,
    DEFAULT_RULE_COMPLIANCE,
  );
}

/**
 * Pick the stricter of two team-tracked floor candidates (either may be absent).
 * Unrecognised values are ignored so a typo never silently weakens the floor.
 */
function stricterTeamFloor(a: string | undefined, b: string | undefined): string | undefined {
  const rank = (raw: string | undefined): number =>
    raw === undefined
      ? -1
      : RULE_COMPLIANCE_MODES.indexOf(raw.trim().toLowerCase() as RuleComplianceMode);
  const rankA = rank(a);
  const rankB = rank(b);
  const winner = Math.max(rankA, rankB);
  return winner < 0 ? undefined : RULE_COMPLIANCE_MODES[winner];
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
 * surfaces and allows. Both remediations it names clear the block in the SAME
 * turn: inline markers are parsed at this seam (issue #307), and `paqad-ai stage`
 * resolves from the installed package on every onboarded project.
 */
function formatMissingStageSummary(stage: string, mode: StagesMode): string {
  const blocking = mode === 'strict';
  const verb = blocking ? 'Needs your attention' : 'Heads up';
  const glyph = blocking ? '🔴' : '🟡';
  const tail = blocking ? '' : ' (warn mode, not blocking)';
  // Artifact-bearing stages (planning/specification/review) must reference a real file
  // at the end so the recorder can hash it — a bare marker pair no longer clears the
  // block (issue #320). Teach the `-- <path>` grammar for those; a plain end otherwise.
  const endMarker = isArtifactBearingStage(stage)
    ? `\`paqad:stage ${stage} end -- <artifact-path>\` (a real, non-empty file — e.g. a plan/spec/findings file)`
    : `\`paqad:stage ${stage} end\``;
  const endCli = isArtifactBearingStage(stage)
    ? `\`npx paqad-ai stage end ${stage} --artifact <artifact-path>\``
    : `\`npx paqad-ai stage end ${stage}\``;
  return (
    `**▸ paqad** · run ${stage} before you change code\n` +
    `> ${glyph} ${verb} — the feature-development workflow needs the **${stage}** stage recorded ` +
    `before this edit. Mark it: emit \`paqad:stage ${stage} start\` and ${endMarker} ` +
    `each on its own line (parsed before the next edit, so they clear this block in the same turn), ` +
    `or run \`npx paqad-ai stage start ${stage}\` then ${endCli}. Set ` +
    `stages_mode=warn/off in .paqad/configs/.config.policy to adopt the workflow before ` +
    `enforcing.${tail}`
  );
}

/** Best-effort same-turn marker sweep (issue #307): before the block-forward
 *  check reads the ledger, parse the turn transcript for `paqad:stage` markers
 *  the agent emitted EARLIER IN THIS TURN and record them. The parse is the same
 *  idempotent routine the Stop hook runs, so the later Stop re-parse never
 *  double-records. Without this, a marker can only take effect at end of turn
 *  and the first mutation of a session is unclearable in-turn. */
function sweepSameTurnMarkers(
  projectRoot: string,
  transcriptPath: string | undefined,
  sessionId: string,
): string {
  if (!transcriptPath) return '';
  let transcriptText: string;
  try {
    transcriptText = readFileSync(transcriptPath, 'utf8');
  } catch {
    return ''; // no transcript to sweep — the ledger check proceeds on what exists
  }
  const recorded = parseAndRecordMarkers({ projectRoot, transcriptText, sessionId });
  return markerBatchNarration(recorded);
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
 *
 * Scope (issue #310): the gate governs FEATURE DEVELOPMENT only. A documentation-only
 * edit (`docs/**`, markdown) or a framework-internal edit (`.paqad/**` — the sentinel,
 * the `.config.policy` escape hatch, the ledger) is not a feature being built, so it
 * is skipped entirely — no planning/specification demanded. The check is
 * language-agnostic (an exclude list, not a `src/` allowlist), so it holds for any
 * onboarded stack; a payload-less call is fail-closed (treated as in-scope).
 */
const stagesCapability: Capability = {
  id: 'stages',
  async evaluate({ projectRoot, seam, env, payload }): Promise<CapabilityOutcome> {
    if (seam !== 'pre-mutation') return NO_OP;
    const mode = resolveStagesMode(projectRoot, env);
    if (mode === 'off') return NO_OP;
    // Only feature-development edits are gated (issue #310). A docs-only or
    // framework-internal edit (incl. the agent-entry sentinel and the .config.policy
    // escape hatch) is not a feature being built — skip it, no stages demanded.
    if (!isFeatureDevEdit(payload?.targetPath, projectRoot)) return NO_OP;
    const blocking = mode === 'strict';

    const sessionId = resolveSessionId(
      projectRoot,
      payload?.sessionId ?? env.CLAUDE_SESSION_ID ?? null,
    );

    // Same-turn markers (issue #307): record any `paqad:stage` markers already
    // emitted this turn BEFORE reading the ledger, so the remediation the block
    // message names actually clears the block within the turn. The narration for
    // every recorded marker rides on the outcome — the ledger write is never silent.
    const narration = sweepSameTurnMarkers(projectRoot, payload?.transcriptPath, sessionId);
    const ordinal = currentOrdinal(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId);

    // The mandatory stages that must exist BEFORE code is written (planning,
    // specification) — one shared source with the live writer's defer condition.
    const prefix = PRE_CODE_STAGES;

    if (ordinal <= 0) {
      // No change opened yet → the first required stage is missing. `prefix` always
      // opens with 'planning' (PRE_CODE_STAGES is a compile-time constant); the ??
      // is a type-satisfying floor for a future reorder, never hit today.
      /* c8 ignore next -- defensive floor: prefix[0] is always 'planning' under the current MANDATORY_STAGES */
      const firstRequired = prefix[0] ?? 'planning';
      return {
        ran: true,
        blocking,
        summary: formatMissingStageSummary(firstRequired, mode),
        narration,
      };
    }

    const fold = foldChange(projectRoot, sessionId, ordinal);
    const byStage = new Map(fold.stages.map((stage) => [stage.stage, stage]));
    for (const stage of prefix) {
      const folded = byStage.get(stage);
      // A recorded start+end pair is necessary but not sufficient for a thinking stage
      // (issue #320): planning/specification are artifact-bearing, so the end must also
      // carry a real artifact digest — a bare marker pair (or a missing/empty file, which
      // hashes to null) does NOT unblock. The marker sweep above records an
      // artifact-bearing end in this same turn, so remediation still clears in one turn.
      const hasPair = Boolean(folded?.started_at && folded?.ended_at);
      const hasArtifact = !isArtifactBearingStage(stage) || Boolean(folded?.artifact_digest);
      if (!hasPair || !hasArtifact) {
        return { ran: true, blocking, summary: formatMissingStageSummary(stage, mode), narration };
      }
    }
    // planning + specification recorded — allow (this edit IS development).
    return { ran: true, blocking: false, summary: '', narration };
  },
};

/**
 * Delivery policy — the completion-seam consumer the `delivery-policy.yaml` never had
 * (RCA Step 5b). At Stop it reads HEAD branch/commit and (when `gh` can answer) the
 * PR/CI state, WARNS on a convention deviation, and appends a `delivery-evidence` row.
 * Warn-floor by design: delivery is `mandatory:false`, so a deviation is surfaced but
 * never blocks (a bad push is caught one turn late, never pre-push — the no-git/CI
 * mandate). No-ops at the pre-mutation seam (the block-forward path owns that). The
 * behaviour lives in `runDeliveryCapability` (runner injected for deterministic tests);
 * here it is bound to the real execa-backed runner.
 */
const deliveryCapability: Capability = {
  id: 'delivery',
  evaluate({ projectRoot, seam }): Promise<CapabilityOutcome> {
    return runDeliveryCapability(projectRoot, seam, execaCommandRunner);
  },
};

/**
 * Decision-pause minters (RCA Step 5c; #300) — the minters the Decision Pause Contract
 * never had. At the pre-mutation seam this runs two, both MINT-only (never block — the
 * existing decision-pause gate blocks the NEXT edit):
 *   1. Self-arm (opt-in, OFF by default): reads the recent prompt from the transcript
 *      and, on a high-confidence create-vs-reuse OR tight architecture-path fork with no
 *      decision pending/made, writes ONE pending packet.
 *   2. Spec-change guard (deterministic, always-on, inert until a spec is frozen): mints
 *      a `spec.change` pause when a persisted frozen spec's source markdown has moved.
 * Self-arm runs first; the guard only runs when self-arm did not mint (one pause per
 * turn — and either way the gate blocks the next edit). Behaviour lives in
 * `runDecisionSelfArm` / `runSpecChangeGuard` (readers injected for tests).
 */
const decisionPauseSelfArmCapability: Capability = {
  id: 'decision-pause',
  async evaluate({ projectRoot, seam, env, payload }): Promise<CapabilityOutcome> {
    const selfArm = runDecisionSelfArm({ projectRoot, seam, env, payload });
    if (selfArm.ran) return selfArm;
    return runSpecChangeGuard({ projectRoot, seam, sessionId: payload?.sessionId ?? null });
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
  [deliveryCapability.id, deliveryCapability],
  [decisionPauseSelfArmCapability.id, decisionPauseSelfArmCapability],
]);
