import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readProjectProfile } from '@/core/project-profile.js';
import { resolveEnterprisePolicy } from '@/core/enterprise-policy.js';
import {
  layeredConfigMap,
  resolveFrameworkConfig,
  resolveSpecPipelineSwitches,
  resolveStageIsolationLanes,
} from '@/core/framework-config.js';
import type { Lane } from '@/core/types/routing.js';
import { resolveDuplicationMode } from '@/duplication/config.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import {
  readChangeConstants,
  readFeatureRecord,
  type ChangeConstants,
} from '@/feature-evidence/feature-record.js';
import {
  isSpecFrozenBeforePipeline,
  type BundleCompletenessConfig,
} from '@/feature-evidence/manifest.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { resolveRuleComplianceMode } from '@/kernel/capability.js';
import { STAGE_AGENT_HOSTS } from '@/stage-isolation/agent-writer.js';
import { isSubagentCapableAdapter, STAGE_AGENT_STAGES } from '@/stage-isolation/stage-agents.js';

export type StageIsolationStatus = 'expected' | 'unresolved' | 'not-applicable';

export function stageIsolationStatus(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): StageIsolationStatus {
  if (!sessionId || !dirName) return 'not-applicable';
  return isolationRead(projectRoot, dirName, readChangeConstantsSafe(projectRoot, dirName)).status;
}

interface IsolationRead {
  status: StageIsolationStatus;
  since: string | null;
}

function isolationRead(
  projectRoot: string,
  dirName: string,
  constants: ChangeConstants | null,
): IsolationRead {
  const status = isolationStatusFrom(constants, resolveIsolationLanes(projectRoot));
  const since =
    status === 'expected'
      ? (readFeatureRecord(projectRoot, dirName)?.lane_raised?.at ?? null)
      : null;
  if (since === null) return { status, since: null };
  return stageStartedSince(projectRoot, dirName, since)
    ? { status, since }
    : { status: 'not-applicable', since: null };
}

function stageStartedSince(projectRoot: string, dirName: string, since: string): boolean {
  const from = Date.parse(since);
  return readFeatureStageUnit(projectRoot, dirName).some(
    (row) =>
      row.kind === 'stage_start' &&
      STAGE_AGENT_STAGES.includes(String(row.stage)) &&
      Date.parse(rowRecordedAt(row) ?? '') >= from,
  );
}

function readChangeConstantsSafe(
  projectRoot: string,
  dirName: string | null,
): ChangeConstants | null {
  if (!dirName) return null;
  try {
    return readChangeConstants(projectRoot, dirName);
  } catch {
    return null;
  }
}

function resolveIsolationLanes(projectRoot: string): readonly Lane[] {
  return resolveStageIsolationLanes(layeredConfigMap(projectRoot, process.env));
}

function isolationStatusFrom(
  constants: ChangeConstants | null,
  lanes: readonly Lane[],
): StageIsolationStatus {
  if (!constants) return 'not-applicable';
  const { lane, adapter } = constants;
  if (!isSubagentCapableAdapter(adapter, STAGE_AGENT_HOSTS)) return 'not-applicable';
  if (lane === null) return 'unresolved';
  return (lanes as readonly string[]).includes(lane) ? 'expected' : 'not-applicable';
}

function isolationFlags(status: StageIsolationStatus): {
  stageIsolationExpected: boolean;
  stageIsolationUnresolved: boolean;
} {
  return {
    stageIsolationExpected: status === 'expected',
    stageIsolationUnresolved: status === 'unresolved',
  };
}

function isolationConfigFrom(
  read: IsolationRead,
): Pick<
  BundleCompletenessConfig,
  'stageIsolationExpected' | 'stageIsolationUnresolved' | 'stageIsolationSince'
> {
  return {
    ...isolationFlags(read.status),
    ...(read.since === null ? {} : { stageIsolationSince: read.since }),
  };
}

export function stageIsolationExpected(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): boolean {
  return stageIsolationStatus(projectRoot, sessionId, dirName) === 'expected';
}

export function isolationConfig(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): { stageIsolationExpected: boolean; stageIsolationUnresolved: boolean } {
  return isolationFlags(stageIsolationStatus(projectRoot, sessionId, dirName));
}

export function buildBundleCompletenessConfig(
  projectRoot: string,
  sessionId: string | null,
  dirName: string | null,
): BundleCompletenessConfig {
  const frameworkConfig = resolveFrameworkConfig(projectRoot);
  const policy = resolveEnterprisePolicy(readProjectProfile(projectRoot));
  const pipelineFlags = readSpecPipelineFlags(projectRoot);
  const constants = readChangeConstantsSafe(projectRoot, dirName);
  return {
    lane: constants?.lane ?? null,
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
    specFrozenBeforePipeline: specFrozenBeforePipeline(projectRoot, dirName),
    ...isolationConfigFrom(
      sessionId && dirName
        ? isolationRead(projectRoot, dirName, constants)
        : { status: 'not-applicable', since: null },
    ),
  };
}

function specFrozenBeforePipeline(projectRoot: string, dirName: string | null): boolean {
  if (!dirName) return false;
  try {
    const text = readFileSync(join(projectRoot, featureFilePath(dirName, 'specification')), 'utf8');
    return isSpecFrozenBeforePipeline(JSON.parse(text));
  } catch {
    return false;
  }
}

export interface SpecPipelineFlags {
  enabled: boolean;
  strict: boolean;
  experts: boolean;
}

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
