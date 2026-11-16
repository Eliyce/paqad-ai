import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { STACK_CAPABILITIES_MAP, STACKS, type Stack } from '@/core/types/domain.js';
import { verifyReadinessToDevelop } from '@/onboarding/readiness.js';
import { collectRuleFiles, computeRuleFilesHash } from '@/rule-scripts/analyzer.js';
import type { RuleScriptMapEvent } from '@/rule-scripts/apply.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { readProposal, signoffCounts } from '@/rules-discovery/proposal.js';
import { readResearch } from '@/rules-discovery/research.js';
import { listRunIds, readRun as readDiscoveryRun } from '@/rules-discovery/run-store.js';

import { parseDegradedCodes, relaxedItems } from './degraded.js';
import { unitRowsForStage } from './fold.js';
import { readJsonLines, readTextOrNull } from './io.js';
import { readModuleUnits } from './modules.js';
import {
  MODULE_REGISTRIES_UNIT,
  PROJECT_DOC_AREAS,
  stageDefinition,
  stagesBefore,
} from './stages.js';
import type { DegradedCode, JourneyEvent, JourneyRun, StageId } from './types.js';

export interface ProofItem {
  item: string;
  ok: boolean;
  message: string;
}

export interface ProofContext {
  projectRoot: string;
  run: JourneyRun;
  events: readonly JourneyEvent[];
}

export type GateResult =
  { ok: true; degraded: DegradedCode[] } | { ok: false; message: string; blocking?: StageId };

const SCRIPTABLE = new Set(['deterministic', 'heuristic']);

function item(name: string, ok: boolean, message: string): ProofItem {
  return { item: name, ok, message };
}

function startedAt(ctx: ProofContext, stage: StageId): string {
  return ctx.run.stages[stage].started_at ?? '9999';
}

function unitIds(ctx: ProofContext, stage: StageId): Map<string, JourneyEvent> {
  const map = new Map<string, JourneyEvent>();
  for (const row of unitRowsForStage(ctx.run, ctx.events, stage)) map.set(row.unit as string, row);
  return map;
}

function proveDetect(ctx: ProofContext): ProofItem[] {
  const detection = ctx.run.detection;
  const fresh = detection !== undefined && detection.detected_at >= startedAt(ctx, 'detect');
  const known = detection !== undefined && (STACKS as readonly string[]).includes(detection.stack);
  const allowed = known ? STACK_CAPABILITIES_MAP[detection.stack as Stack] : [];
  const capsOk =
    detection?.capabilities.every((cap) => (allowed as readonly string[]).includes(cap)) ?? false;
  const reasoned = (detection?.reason.trim().length ?? 0) > 0;
  return [
    item(
      'detection',
      fresh && known && capsOk && reasoned,
      'Record a stack from STACKS with valid capabilities and a reason in this run (`onboarding detect` or `onboarding choose-stack`).',
    ),
  ];
}

function proveSetup(ctx: ProofContext): ProofItem[] {
  const setup = ctx.run.setup;
  const fresh = setup !== undefined && setup.completed_at >= startedAt(ctx, 'setup');
  return [
    item(
      'setup_result',
      fresh && setup.generated_files.length > 0,
      'Run `onboarding setup` in this run.',
    ),
    item(
      'no_step_failures',
      fresh && setup.step_failures.length === 0,
      'Setup reported failed steps; run `onboarding setup --compile-only` after fixing them.',
    ),
    item(
      'framework_path',
      readTextOrNull(join(ctx.projectRoot, PATHS.FRAMEWORK_PATH)) !== null,
      `${PATHS.FRAMEWORK_PATH} is missing.`,
    ),
    item(
      'manifest',
      readTextOrNull(join(ctx.projectRoot, PATHS.ONBOARDING_MANIFEST)) !== null,
      `${PATHS.ONBOARDING_MANIFEST} is missing.`,
    ),
  ];
}

function proveProjectDocs(ctx: ProofContext): ProofItem[] {
  const units = unitIds(ctx, 'project_docs');
  const items = PROJECT_DOC_AREAS.map((area) =>
    item(
      `area:${area}`,
      units.has(area),
      `Record the "${area}" doc area with \`onboarding unit project_docs ${area}\`.`,
    ),
  );
  const modules = readModuleUnits(ctx.projectRoot);
  items.push(
    item(
      'module_map',
      modules !== null && modules.length > 0,
      'module-map.yml is missing or lists no modules.',
    ),
  );
  return items;
}

function proveModuleDocs(ctx: ProofContext): ProofItem[] {
  const units = unitIds(ctx, 'module_docs');
  const modules = readModuleUnits(ctx.projectRoot) ?? [];
  const items = modules.map((module) => {
    const row = units.get(module.slug);
    const ok =
      row !== undefined &&
      (row.source_hash === undefined || row.source_hash === module.source_hash);
    return item(
      `module:${module.slug}`,
      ok,
      `Write the docs for module "${module.slug}" and record it.`,
    );
  });
  items.push(
    item('module_map', modules.length > 0, 'module-map.yml is missing or lists no modules.'),
  );
  items.push(
    item(
      MODULE_REGISTRIES_UNIT,
      units.has(MODULE_REGISTRIES_UNIT),
      'Rebuild the registries and record the "registries" unit.',
    ),
  );
  return items;
}

function latestDiscoveryRunId(ctx: ProofContext): string | null {
  const since = startedAt(ctx, 'rules_discovery');
  const fresh = listRunIds(ctx.projectRoot).filter((id) => {
    const read = readDiscoveryRun(ctx.projectRoot, id);
    return read.state === 'ok' && read.record.updated_at >= since;
  });
  return fresh.at(-1) ?? null;
}

function proveRulesDiscovery(ctx: ProofContext): ProofItem[] {
  const runId = latestDiscoveryRunId(ctx);
  const read = runId ? readDiscoveryRun(ctx.projectRoot, runId) : null;
  const done = read?.state === 'ok' && read.record.status === 'done';
  const proposal = runId ? readProposal(ctx.projectRoot, runId) : null;
  const counts = proposal ? signoffCounts(proposal) : { added: 0, changed: 0, removed: 0 };
  const research = runId ? readResearch(ctx.projectRoot, runId) : null;
  return [
    item('discovery_run', done, 'Finish a rules discovery run in this step.'),
    item(
      'no_removed',
      counts.removed === 0,
      'The sign-off would remove existing rules; the journey only adds rules.',
    ),
    item(
      'no_changed',
      counts.changed === 0,
      'The sign-off would change existing rules; the journey only adds rules.',
    ),
    item(
      'research_online',
      research !== null && research.state !== 'skipped-offline',
      'Research ran offline.',
    ),
    item(
      'all_packages',
      research !== null && research.state !== 'stopped' && research.unreached.length === 0,
      'Research stopped before every package was read.',
    ),
  ];
}

function analyzeAuditRows(ctx: ProofContext): RuleScriptMapEvent[] {
  return readJsonLines<RuleScriptMapEvent>(
    join(ctx.projectRoot, PATHS.RULE_SCRIPT_MAP_EVENTS_LOG),
    (row) => row.via === 'rule-analyzer' && row.action === 'analyze' && Array.isArray(row.rule_ids),
  );
}

function compileAuditRows(ctx: ProofContext): RuleScriptMapEvent[] {
  return readJsonLines<RuleScriptMapEvent>(
    join(ctx.projectRoot, PATHS.RULE_SCRIPT_MAP_EVENTS_LOG),
    (row) => row.via === 'rules-compile' && typeof row.ts === 'string',
  );
}

function proveRulesAnalyze(ctx: ProofContext): ProofItem[] {
  const map = loadRuleScriptMap(ctx.projectRoot);
  const since = startedAt(ctx, 'rules_analyze');
  const covered = new Set(
    analyzeAuditRows(ctx)
      .filter((row) => row.ts >= since)
      .flatMap((row) => row.rule_ids),
  );
  const allCovered =
    map !== null && map.rules.length > 0 && map.rules.every((rule) => covered.has(rule.id));
  const hashOk =
    map !== null &&
    map.rule_files_hash ===
      computeRuleFilesHash(ctx.projectRoot, collectRuleFiles(ctx.projectRoot));
  return [
    item(
      'analyze_audit',
      allCovered,
      'Run the rule analyzer in this step so its audit row covers every rule.',
    ),
    item('rule_files_hash', hashOk, 'The rule files changed after the analysis; analyze again.'),
  ];
}

function proveRuleScripts(ctx: ProofContext): ProofItem[] {
  const map = loadRuleScriptMap(ctx.projectRoot);
  if (map === null) return [item('rule_script_map', false, 'The rule-script map is missing.')];
  const items = map.rules
    .filter((rule) => SCRIPTABLE.has(rule.verifiability.kind) && rule.enforced_by.length === 0)
    .map((rule) => {
      const registered = rule.scripts.some((script) => script.fixtures_passed);
      return item(
        `rule:${rule.id}`,
        registered,
        `Register a passing check for ${rule.id} or mark it unverifiable with an "onboarding:" reason.`,
      );
    });
  const since = startedAt(ctx, 'rule_scripts');
  items.push(
    item(
      'compile',
      compileAuditRows(ctx).some((row) => row.ts >= since),
      'Run `paqad-ai rules compile` after the checks are registered.',
    ),
  );
  return items;
}

function proveFinish(ctx: ProofContext): ProofItem[] {
  const reportText = readTextOrNull(join(ctx.projectRoot, PATHS.ONBOARDING_REPORT_JSON));
  const report = reportText
    ? (JSON.parse(reportText) as { generated_at?: string; rag?: string })
    : null;
  const fresh = report !== null && (report.generated_at ?? '') >= startedAt(ctx, 'finish');
  const markdown = readTextOrNull(join(ctx.projectRoot, PATHS.ONBOARDING_REPORT_MD)) !== null;
  const readiness = verifyReadinessToDevelop(ctx.projectRoot);
  return [
    item(
      'report',
      fresh && markdown,
      'Run `onboarding finish` to write report.json and report.md.',
    ),
    item('readiness', readiness.ready, `Not ready to develop: ${readiness.blockers.join('; ')}`),
    item(
      'rag_ready',
      report?.rag === 'ready' || report?.rag === 'installing',
      'The search index is not ready.',
    ),
  ];
}

const PROOFS: Record<StageId, (ctx: ProofContext) => ProofItem[]> = {
  detect: proveDetect,
  setup: proveSetup,
  project_docs: proveProjectDocs,
  module_docs: proveModuleDocs,
  rules_discovery: proveRulesDiscovery,
  rules_analyze: proveRulesAnalyze,
  rule_scripts: proveRuleScripts,
  finish: proveFinish,
};

export function proveStage(ctx: ProofContext, stage: StageId): ProofItem[] {
  return PROOFS[stage](ctx);
}

export function checkStartGate(run: JourneyRun, stage: StageId): GateResult {
  for (const before of stagesBefore(stage)) {
    const record = run.stages[before.id];
    const allowed =
      record.status === 'degraded' &&
      (record.degraded ?? []).every((code) => before.allowed_degraded.includes(code));
    if (record.status === 'done' || allowed) continue;
    const why =
      record.status === 'degraded'
        ? 'ended with a gap that blocks the next step'
        : 'is not done yet';
    return {
      ok: false,
      blocking: before.id,
      message: `Step ${stageDefinition(stage).index} (${stageDefinition(stage).name}) cannot start: step ${before.index} (${before.name}) ${why}.`,
    };
  }
  return { ok: true, degraded: [] };
}

export function checkEndGate(
  ctx: ProofContext,
  stage: StageId,
  rawDegraded: readonly string[],
): GateResult {
  const record = ctx.run.stages[stage];
  if (record.status !== 'running') {
    return {
      ok: false,
      message: `Step ${stageDefinition(stage).index} (${stageDefinition(stage).name}) is not running.`,
    };
  }
  const parsed = parseDegradedCodes(stage, rawDegraded);
  if (!parsed.ok) return parsed;
  const relaxed = relaxedItems(parsed.codes);
  const missing = proveStage(ctx, stage).filter((proof) => !proof.ok && !relaxed.has(proof.item));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Step ${stageDefinition(stage).index} (${stageDefinition(stage).name}) has no proof from this run: ${missing
        .map((proof) => `${proof.item} (${proof.message})`)
        .join('; ')}`,
    };
  }
  return { ok: true, degraded: parsed.codes };
}
