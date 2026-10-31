import { readFileSync } from 'node:fs';

import { resolveFlooredMode } from '@/core/floored-mode.js';
import {
  readConfigsDir,
  readDotConfig,
  resolveRuleGateConfig,
  type RuleGateConfig,
} from '@/core/framework-config.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';
import { readProjectRuleComplianceModeOverride } from '@/pipeline/feature-development-policy.js';
import { classifyCompletionEnforcement } from '@/pipeline/session-ownership.js';
import { execaCommandRunner, runDeliveryCapability } from '@/delivery/delivery-check.js';
import { runDecisionSelfArm } from '@/planning/decision-selfarm.js';
import { runSpecChangeGuard } from '@/spec/spec-change-guard.js';
import {
  enforceRuleScripts,
  type EnforcementResult,
  type RuleViolation,
} from '@/rule-scripts/enforce.js';
import {
  clearPendingPreMutation,
  hasPendingPreMutation,
  writePendingPreMutation,
} from '@/rule-scripts/pending-marker.js';
import { computeRuleScriptsDigest } from '@/rule-scripts/integrity.js';
import type { RuleComplianceMode } from '@/rule-scripts/runner.js';
import { classifyBundlePath } from '@/feature-evidence/bundle-integrity.js';
import { bundleWriterFor } from '@/feature-evidence/manifest.js';
import { SCREENSHOTS_DIR } from '@/feature-evidence/paths.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';
import { changedLoadedRuleSources, readRulesLoaded } from '@/feature-evidence/rules-loaded.js';
import { readCompiledRules } from '@/planning/rule-compiler.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { normalizeArtifactPath } from '@/stage-evidence/artifact-path.js';
import { PATHS } from '@/core/constants/paths.js';
import { parseAndRecordMarkers } from '@/stage-evidence/marker-parse.js';
import { markerBatchNarration } from '@/stage-evidence/narration.js';
import { resolveStagesMode, type StagesMode } from '@/stage-evidence/mode.js';
import { changeIsFeatureDev, isFeatureDevEdit } from '@/stage-evidence/scope.js';
import { resolveEffectiveLane } from '@/stage-evidence/effective-lane.js';
import {
  isArtifactBearingStage,
  PRE_CODE_STAGES,
  requiredPreCodeStages,
} from '@/stage-evidence/stages.js';

import { readCapabilityDigest } from './capability-lock.js';
import { evaluateCapabilityCompat, isRefusedByCompat } from './compat.js';
import {
  getCapability,
  type CapabilityDescriptor,
  type CapabilityPayload,
  type CapabilitySeam,
} from './registry.js';

export interface CapabilityContext {
  projectRoot: string;
  seam: CapabilitySeam;
  env: NodeJS.ProcessEnv;
  payload?: CapabilityPayload;
  startedAt?: number;
  now?: () => number;
}

export interface CapabilityOutcome {
  ran: boolean;
  blocking: boolean;
  summary: string;
  narration?: string;
  violations?: RuleViolation[];
  context?: string;
}

const NO_OP: CapabilityOutcome = { ran: false, blocking: false, summary: '' };

export interface Capability {
  id: CapabilityDescriptor['id'];
  evaluate(context: CapabilityContext): Promise<CapabilityOutcome>;
}

const RULE_COMPLIANCE_MODES = ['off', 'warn', 'strict'] as const;
const DEFAULT_RULE_COMPLIANCE: RuleComplianceMode = 'warn';

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

type IntegrityStatus = 'ok' | 'tampered' | 'unverified';

function verifyRuleScriptsIntegrity(projectRoot: string): IntegrityStatus {
  const digest = computeRuleScriptsDigest(projectRoot);
  if (digest === null) {
    return 'ok';
  }
  const locked = readCapabilityDigest(projectRoot, 'rule-scripts');
  if (locked === null) {
    return 'unverified';
  }
  return locked === digest ? 'ok' : 'tampered';
}

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

function formatNoneArmedSummary(): string {
  return (
    `**▸ paqad** · scripted rules: ⚪ none armed\n` +
    `> No rule-scripts are registered for this repo, so I ran no scripted enforcement. Your ` +
    `checks passed on the toolchain (format/tests/build), not on the team's rule-scripts — ` +
    `arm them with \`generate rule scripts\` to enforce the rules deterministically.`
  );
}

function formatUnverifiedSummary(): string {
  return (
    `**▸ paqad** · scripted-rule bindings not yet attested\n` +
    `> 🟡 Heads up — your rule-script bindings have no integrity lock yet, so I can't attest ` +
    `they are unchanged. Re-run \`generate rule scripts\` to bless them. (advisory, not blocking)`
  );
}

function formatCompatRefusalSummary(): string {
  return (
    `**▸ paqad** · scripted-rule enforcement paused — framework update pending\n` +
    `> 🟡 Heads up — this project's rule-script bindings were blessed by a newer paqad than ` +
    `the one installed here, so I'm holding off enforcing them rather than risk misreading a ` +
    `newer format. The framework self-heals on update, then I'll resume. (advisory, not blocking)`
  );
}

export const RULE_GATE_BUDGET_CONTEXT =
  'paqad: the blocking rule checks did not finish in time for this edit. They will run again ' +
  'at the end of this turn and block there if anything fails.';

const PRE_EDIT_FILTER = {
  kinds: ['deterministic' as const],
  scopes: ['changed-files' as const],
};

function formatPendingUnwritableSummary(): string {
  return (
    `**▸ paqad** · blocking rule checks could not be deferred\n` +
    `> 🔴 Needs your attention — the blocking rule checks did not finish in time for this edit, ` +
    `and I could not record that they still have to run at the end of this turn, so I stopped ` +
    `the edit. Check that \`.paqad/scripts/rules/.cache/\` is writable, then re-try the edit.`
  );
}

function payloadSessionId(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  payload: CapabilityPayload | undefined,
): string {
  return resolveSessionId(projectRoot, payload?.sessionId ?? env.CLAUDE_SESSION_ID ?? null);
}

function payloadTargets(payload: CapabilityPayload | undefined): string[] {
  return payload?.targetPaths ?? (payload?.targetPath ? [payload.targetPath] : []);
}

async function enforceBeforeEdit(
  context: CapabilityContext,
  mode: RuleComplianceMode,
  gate: RuleGateConfig,
): Promise<EnforcementResult> {
  const now = context.now ?? Date.now;
  const remaining = (context.startedAt ?? now()) + gate.budgetMs - now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, remaining));
  if (remaining <= 0) controller.abort();
  try {
    return await enforceRuleScripts({
      projectRoot: context.projectRoot,
      mode,
      scope: 'whole-tree',
      ...(gate.preEdit === 'blocking-only'
        ? { ...PRE_EDIT_FILTER, useFileCache: true, editTargets: payloadTargets(context.payload) }
        : {}),
      concurrency: gate.concurrency,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function deferToTurnEnd(context: CapabilityContext): CapabilityOutcome {
  const { projectRoot, env, payload } = context;
  const sessionId = payloadSessionId(projectRoot, env, payload);
  const files = payload?.targetPaths?.length ?? (payload?.targetPath ? 1 : 0);
  try {
    writePendingPreMutation(projectRoot, {
      session_id: sessionId,
      change: currentFeature(projectRoot, sessionId) ?? null,
      written_at: new Date((context.now ?? Date.now)()).toISOString(),
      files,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code ?? 'unknown';
    appendHooksLog(
      projectRoot,
      `capability-gate rule-scripts pending-unwritable ${code} session=${sessionId} files=${files}`,
    );
    return { ran: true, blocking: true, summary: formatPendingUnwritableSummary() };
  }
  appendHooksLog(
    projectRoot,
    `capability-gate rule-scripts budget-exhausted session=${sessionId} files=${files}`,
  );
  return { ran: true, blocking: false, summary: '', context: RULE_GATE_BUDGET_CONTEXT };
}

function payloadFeatureDev(
  payload: { targetPath?: string; targetPaths?: string[] } | undefined,
  projectRoot: string,
): boolean {
  if (payload?.targetPaths && payload.targetPaths.length > 0) {
    return changeIsFeatureDev(payload.targetPaths, projectRoot);
  }
  return isFeatureDevEdit(payload?.targetPath, projectRoot);
}

const ruleScriptsCapability: Capability = {
  id: 'rule-scripts',
  async evaluate(context): Promise<CapabilityOutcome> {
    const { projectRoot, seam, env, payload } = context;
    if (seam === 'pre-mutation' && !payloadFeatureDev(payload, projectRoot)) {
      return NO_OP;
    }
    const pendingSession =
      seam === 'completion' ? payloadSessionId(projectRoot, env, payload) : null;
    const pending = pendingSession !== null && hasPendingPreMutation(projectRoot, pendingSession);
    if (
      seam === 'completion' &&
      !pending &&
      !classifyCompletionEnforcement(
        projectRoot,
        payload?.sessionId ?? env.CLAUDE_SESSION_ID ?? null,
      ).enforce
    ) {
      return NO_OP;
    }
    const mode = resolveRuleComplianceMode(projectRoot, env);
    if (mode === 'off') {
      return NO_OP;
    }
    if (isRefusedByCompat(evaluateCapabilityCompat(projectRoot, getCapability('rule-scripts')))) {
      return { ran: true, blocking: false, summary: formatCompatRefusalSummary() };
    }
    const integrity = verifyRuleScriptsIntegrity(projectRoot);
    if (integrity === 'tampered') {
      return { ran: true, blocking: mode === 'strict', summary: formatTamperSummary(mode) };
    }
    const result =
      seam === 'pre-mutation'
        ? await enforceBeforeEdit(context, mode, resolveRuleGateConfig(projectRoot, env))
        : await enforceRuleScripts({ projectRoot, mode, scope: 'changed-files' });
    if (result.aborted) {
      return deferToTurnEnd(context);
    }
    if (pending && pendingSession !== null) {
      clearPendingPreMutation(projectRoot, pendingSession);
    }
    if (!result.ran) {
      if (seam === 'completion' && result.armed === 0) {
        return { ran: true, blocking: false, summary: formatNoneArmedSummary() };
      }
      return NO_OP;
    }
    if (result.violations.length === 0) {
      return integrity === 'unverified'
        ? { ran: true, blocking: false, summary: formatUnverifiedSummary() }
        : NO_OP;
    }
    return {
      ran: true,
      blocking: result.blocking,
      summary: result.summary,
      violations: result.violations,
    };
  },
};

function formatMissingStageSummary(stage: string, mode: StagesMode): string {
  const blocking = mode === 'strict';
  const verb = blocking ? 'Needs your attention' : 'Heads up';
  const glyph = blocking ? '🔴' : '🟡';
  const tail = blocking ? '' : ' (warn mode, not blocking)';
  const endMarker = isArtifactBearingStage(stage)
    ? `\`paqad:stage ${stage} end -- <artifact-path>\` (a real, non-empty file — e.g. a plan/spec/findings file)`
    : `\`paqad:stage ${stage} end\``;
  const endCli = isArtifactBearingStage(stage)
    ? `\`paqad-ai stage end ${stage} --artifact <artifact-path>\``
    : `\`paqad-ai stage end ${stage}\``;
  return (
    `**▸ paqad** · run ${stage} before you change code\n` +
    `> ${glyph} ${verb} — the feature-development workflow needs the **${stage}** stage recorded ` +
    `before this edit. Mark it: emit \`paqad:stage ${stage} start\` and ${endMarker} ` +
    `each on its own line (parsed before the next edit, so they clear this block in the same turn), ` +
    `or run \`paqad-ai stage start ${stage}\` then ${endCli}. Set ` +
    `stages_mode=warn/off in .paqad/configs/.config.policy to adopt the workflow before ` +
    `enforcing.${tail}`
  );
}

function sweepSameTurnMarkers(
  projectRoot: string,
  transcriptPath: string | undefined,
  sessionId: string,
  adapter: string | undefined,
): string {
  if (!transcriptPath) return '';
  let transcriptText: string;
  try {
    transcriptText = readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  const recorded = parseAndRecordMarkers({ projectRoot, transcriptText, sessionId, adapter });
  return markerBatchNarration(recorded);
}

function bundleFileWriter(filename: string): string | null {
  if (filename === SCREENSHOTS_DIR || filename.startsWith(`${SCREENSHOTS_DIR}/`)) {
    return 'paqad-ai visual-evidence run (or visual-evidence attach)';
  }
  return bundleWriterFor(filename);
}

function formatBundleWriteSummary(relPath: string, writer: string | null): string {
  const remedy = writer
    ? `This file is written by \`${writer}\`. Run that verb and hand it your content instead.`
    : `No verb writes this file, so it does not belong in the bundle. Keep your notes outside ` +
      `\`.paqad/ledger/feature-evidence/\`.`;
  return (
    `**▸ paqad** · bundle files are written by paqad, not by hand\n` +
    `> 🔴 Needs your attention — \`${relPath}\` sits inside a feature evidence bundle, and ` +
    `every file there is created by a paqad verb so the record can be trusted. ${remedy}`
  );
}

function normalizedPayloadTargets(
  payload: { targetPath?: string; targetPaths?: string[] } | undefined,
  projectRoot: string,
): string[] {
  const targets =
    payload?.targetPaths && payload.targetPaths.length > 0
      ? payload.targetPaths
      : payload?.targetPath
        ? [payload.targetPath]
        : [];
  const rels: string[] = [];
  for (const target of targets) {
    try {
      rels.push(normalizeArtifactPath(projectRoot, target));
    } catch {
      continue;
    }
  }
  return rels;
}

function firstBundleTarget(targets: string[]): { rel: string; filename: string } | null {
  for (const rel of targets) {
    const classified = classifyBundlePath(rel);
    if (classified) return { rel, filename: classified.filename };
  }
  return null;
}

function firstChecksRecordTarget(targets: string[]): string | null {
  return (
    targets.find((rel) => rel === PATHS.CHECKS_DIR || rel.startsWith(`${PATHS.CHECKS_DIR}/`)) ??
    null
  );
}

function formatChecksRecordWriteSummary(relPath: string): string {
  return (
    `**▸ paqad** · checks records are written by paqad, not by hand\n` +
    `> 🔴 Needs your attention — \`${relPath}\` is part of the checks record (the run history, ` +
    `the run snapshots and the last report). Only \`paqad-ai checks run\` writes it, so a green ` +
    `result there can be trusted. Run \`paqad-ai checks run\` instead.`
  );
}

const stagesCapability: Capability = {
  id: 'stages',
  async evaluate({ projectRoot, seam, env, payload }): Promise<CapabilityOutcome> {
    if (seam !== 'pre-mutation') return NO_OP;
    const targets = normalizedPayloadTargets(payload, projectRoot);
    const checksTarget = firstChecksRecordTarget(targets);
    if (checksTarget) {
      return { ran: true, blocking: true, summary: formatChecksRecordWriteSummary(checksTarget) };
    }
    const bundleTarget = firstBundleTarget(targets);
    if (bundleTarget) {
      return {
        ran: true,
        blocking: true,
        summary: formatBundleWriteSummary(
          bundleTarget.rel,
          bundleFileWriter(bundleTarget.filename),
        ),
      };
    }
    const mode = resolveStagesMode(projectRoot, env);
    if (mode === 'off') return NO_OP;
    if (!payloadFeatureDev(payload, projectRoot)) return NO_OP;
    const blocking = mode === 'strict';

    const sessionId = resolveSessionId(
      projectRoot,
      payload?.sessionId ?? env.CLAUDE_SESSION_ID ?? null,
    );

    const narration = sweepSameTurnMarkers(
      projectRoot,
      payload?.transcriptPath,
      sessionId,
      payload?.adapter,
    );
    const dirName = currentFeature(projectRoot, sessionId);

    const prefix = PRE_CODE_STAGES;

    if (!dirName) {
      /* c8 ignore next -- defensive floor: prefix[0] is always 'planning' under the current MANDATORY_STAGES */
      const firstRequired = prefix[0] ?? 'planning';
      return {
        ran: true,
        blocking,
        summary: formatMissingStageSummary(firstRequired, mode),
        narration,
      };
    }

    const fold = foldFeature(projectRoot, sessionId, dirName);
    const byStage = new Map(fold.stages.map((stage) => [stage.stage, stage]));
    const effectiveLane = resolveEffectiveLane(projectRoot, payload?.targetPath, fold.lane);
    const requiredStages = requiredPreCodeStages(effectiveLane);
    for (const stage of requiredStages) {
      const folded = byStage.get(stage);
      const hasPair = Boolean(folded?.started_at && folded?.ended_at);
      const hasArtifact = !isArtifactBearingStage(stage) || Boolean(folded?.artifact_digest);
      if (!hasPair || !hasArtifact) {
        return { ran: true, blocking, summary: formatMissingStageSummary(stage, mode), narration };
      }
    }
    return { ran: true, blocking: false, summary: '', narration };
  },
};

function formatRulesNotLoadedSummary(): string {
  return (
    `**▸ paqad** · rules not loaded for this change\n` +
    `> 🔴 Needs your attention — you are editing code but I have no record that the ` +
    `applicable project rules were loaded. Read them and record it: run \`paqad-ai rules ` +
    `load\` (it prints the rules that apply to your changed files and writes the evidence), ` +
    `then re-try the edit.`
  );
}

function formatRulesChangedSummary(changed: readonly string[]): string {
  return (
    `**▸ paqad** · rules changed since you loaded them\n` +
    `> 🔴 Needs your attention — the text of ${changed.length} rule${changed.length === 1 ? '' : 's'} ` +
    `you loaded for this change has changed since: ${changed.join(', ')}. Read the new text: ` +
    `run \`paqad-ai rules load\`, then re-try the edit.`
  );
}

const rulesLoadedCapability: Capability = {
  id: 'rules-loaded',
  async evaluate({ projectRoot, seam, env, payload }): Promise<CapabilityOutcome> {
    if (seam !== 'pre-mutation') return NO_OP;
    if (!payloadFeatureDev(payload, projectRoot)) return NO_OP;
    const store = await readCompiledRules(projectRoot);
    if (!store || (store.rules?.length ?? 0) === 0) return NO_OP;
    const sessionId = resolveSessionId(
      projectRoot,
      payload?.sessionId ?? env.CLAUDE_SESSION_ID ?? null,
    );
    const dirName = currentFeature(projectRoot, sessionId);
    if (!dirName) return NO_OP;
    const record = readRulesLoaded(projectRoot, dirName);
    if (!record) {
      return { ran: true, blocking: true, summary: formatRulesNotLoadedSummary() };
    }
    const changed = changedLoadedRuleSources(projectRoot, record);
    if (changed.length === 0) return NO_OP;
    return { ran: true, blocking: true, summary: formatRulesChangedSummary(changed) };
  },
};

const deliveryCapability: Capability = {
  id: 'delivery',
  evaluate({ projectRoot, seam }): Promise<CapabilityOutcome> {
    return runDeliveryCapability(projectRoot, seam, execaCommandRunner);
  },
};

const decisionPauseSelfArmCapability: Capability = {
  id: 'decision-pause',
  async evaluate({ projectRoot, seam, env, payload }): Promise<CapabilityOutcome> {
    const selfArm = runDecisionSelfArm({ projectRoot, seam, env, payload });
    if (selfArm.ran) return selfArm;
    return runSpecChangeGuard({ projectRoot, seam, sessionId: payload?.sessionId ?? null });
  },
};

export const CAPABILITY_IMPLS: ReadonlyMap<CapabilityDescriptor['id'], Capability> = new Map([
  [ruleScriptsCapability.id, ruleScriptsCapability],
  [stagesCapability.id, stagesCapability],
  [rulesLoadedCapability.id, rulesLoadedCapability],
  [deliveryCapability.id, deliveryCapability],
  [decisionPauseSelfArmCapability.id, decisionPauseSelfArmCapability],
]);
