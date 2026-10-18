// The bundle-completeness config (issues #511, #573, #602, #639): which bundle files a
// change must leave, resolved from the project's config and the change's own constants. Its
// own module so the completeness gate and the HUD snapshot share one builder, and the snapshot
// does not load the whole verification run to get it.

import { readProjectProfile } from '@/core/project-profile.js';
import { resolveEnterprisePolicy } from '@/core/enterprise-policy.js';
import {
  layeredConfigMap,
  resolveFrameworkConfig,
  resolveSpecPipelineSwitches,
} from '@/core/framework-config.js';
import { resolveDuplicationMode } from '@/duplication/config.js';
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import type { BundleCompletenessConfig } from '@/feature-evidence/manifest.js';
import { resolveRuleComplianceMode } from '@/kernel/capability.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';
import { isSubagentCapableAdapter } from '@/stage-isolation/stage-agents.js';

/**
 * How stage isolation stands for a change (issues #573, #602), on a subagent-capable host:
 *   - `expected`    — a graduated or full lane: isolation should have run, and its absence is a
 *                     hard failure.
 *   - `unresolved`  — the lane never resolved (null): isolation could not be judged, so its
 *                     absence must be SURFACED (Inconclusive), never a clean green and never a
 *                     hard block (issue #602, FR-4). A lost or first-glance-only label lands
 *                     here instead of silently reading "no scrutiny needed".
 *   - `not-applicable` — the fast lane, a host with no subagent dispatch, or no bundle to read.
 *
 * The lane and host are the bundle's own session constants (`feature.json`, else a pre-#581
 * bundle's open row), so a change is judged by what it actually recorded.
 */
export type StageIsolationStatus = 'expected' | 'unresolved' | 'not-applicable';

export function stageIsolationStatus(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): StageIsolationStatus {
  if (!sessionId || !dirName) return 'not-applicable';
  try {
    const { lane, adapter } = readChangeConstants(projectRoot, dirName);
    // A host that cannot dispatch subagents could never isolate, so isolation is never asked of
    // it — whatever the lane.
    if (!isSubagentCapableAdapter(adapter, STAGE_AGENT_HOSTS)) return 'not-applicable';
    if (lane === 'graduated' || lane === 'full') return 'expected';
    // A null lane is unresolved — surfaced, not silent (issue #602). A fast lane is genuinely
    // not-applicable.
    return lane === null ? 'unresolved' : 'not-applicable';
  } catch {
    // A missing or unreadable bundle cannot prove anything about isolation.
    return 'not-applicable';
  }
}

/**
 * Whether stage isolation was EXPECTED for a change (issue #573): the `expected` case above.
 * Kept as a thin predicate so existing callers read unchanged.
 *
 * Returns false for an unresolved lane. That is deliberate — a null lane must not manufacture a
 * blocking requirement out of nothing (INV-5); the `unresolved` status surfaces it instead.
 */
export function stageIsolationExpected(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): boolean {
  return stageIsolationStatus(projectRoot, sessionId, dirName) === 'expected';
}

/**
 * The two isolation flags the bundle-completeness manifest reads (issue #602), from ONE status
 * read so `expected` and `unresolved` can never both be set. `expected` hard-requires the
 * isolation proof; `unresolved` surfaces its absence as Inconclusive.
 */
export function isolationConfig(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): { stageIsolationExpected: boolean; stageIsolationUnresolved: boolean } {
  const status = stageIsolationStatus(projectRoot, sessionId, dirName);
  return {
    stageIsolationExpected: status === 'expected',
    stageIsolationUnresolved: status === 'unresolved',
  };
}

/**
 * The resolved bundle-completeness config for a change (issue #639, Part 7): the flags that
 * decide which bundle files are required. Extracted so the completeness gate and the HUD
 * snapshot read one builder and can never disagree about what a change must leave.
 */
export function buildBundleCompletenessConfig(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): BundleCompletenessConfig {
  const frameworkConfig = resolveFrameworkConfig(projectRoot);
  const policy = resolveEnterprisePolicy(readProjectProfile(projectRoot));
  // Issue #547 (FR-10.1) / #581 — the spec-pipeline flags, read via layeredConfigMap (not
  // src/spec-pipeline) so the FR-11 import ban holds: src/verification/** must not import the
  // pipeline.
  const pipelineFlags = readSpecPipelineFlags(projectRoot);
  return {
    ruleComplianceOn: resolveRuleComplianceMode(projectRoot) !== 'off',
    metricsEnabled: frameworkConfig.features.metrics_enabled,
    duplicationOn: resolveDuplicationMode(projectRoot) !== 'off',
    featureReport: frameworkConfig.features.feature_report,
    ragEnabled: frameworkConfig.intelligence.rag_enabled,
    enterprise: policy.enabled,
    evidenceLedger: policy.evidence_ledger,
    aiBom: policy.ai_bom,
    specPipelineStrict: pipelineFlags.strict,
    specPipelineEnabled: pipelineFlags.enabled,
    expertsEnabled: pipelineFlags.experts,
    // Issue #573 / #602 — how stage isolation stands for this change, read from the
    // bundle's own constants (lane + recorded host adapter), never from config: whether
    // isolation applied is a property of the change, not a project setting. `expected`
    // hard-requires the proof; `unresolved` surfaces its absence as Inconclusive (a lost or
    // first-glance-only label is loud, not silent) without ever false-failing (INV-5).
    ...isolationConfig(projectRoot, sessionId, dirName),
  };
}

/** The spec-pipeline flags the bundle-completeness manifest reads (issues #547, #581). */
export interface SpecPipelineFlags {
  /** spec_pipeline_enabled. */
  enabled: boolean;
  /** spec_pipeline_enabled && spec_pipeline_adoption === 'strict'. */
  strict: boolean;
  /** spec_pipeline_experts_enabled (the manifest pairs it with `enabled`). */
  experts: boolean;
}

/**
 * Read the spec-pipeline flags from the layered config map. Read here, not through
 * src/spec-pipeline, so the FR-11 import ban holds (src/verification/** must not import the
 * pipeline). An unset flag takes its SPEC_PIPELINE_DEFAULTS value through the same resolver
 * the pipeline uses (issue #640), so the two can never disagree.
 */
export function readSpecPipelineFlags(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): SpecPipelineFlags {
  const switches = resolveSpecPipelineSwitches(layeredConfigMap(projectRoot, env));
  return {
    enabled: switches.enabled,
    strict: switches.enabled && switches.adoption === 'strict',
    experts: switches.experts_enabled,
  };
}
