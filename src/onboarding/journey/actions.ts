import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { ADAPTER_TYPES } from '@/core/types/adapter.js';

import { appendChoice } from './choices.js';
import { JourneyRefusal } from './errors.js';
import { appendEvent, readEvents } from './events.js';
import { foldJourney, foldStage } from './fold.js';
import { readModuleUnits } from './modules.js';
import { normalizeOutputPath } from './paths.js';
import { fileSha256 } from './preflight.js';
import { checkEndGate, checkStartGate } from './proof.js';
import { flagJourneyRuleChecks, ruleIds } from './rule-checks.js';
import { createRun, emptyStages, readRun, requireRun, updateRun } from './run-store.js';
import { MODULE_REGISTRIES_UNIT, PROJECT_DOC_AREAS, stageDefinition } from './stages.js';
import type { JourneyRun, StageId } from './types.js';

export type Clock = () => Date;

export interface StartInput {
  providers: string[];
  session: string;
  allowList: boolean;
  asked: 'tray' | 'agent-attested';
  baseline: Record<string, string | null>;
}

export function validateProviders(providers: readonly string[]): string[] {
  if (providers.length === 0) throw new JourneyRefusal('Tick at least one AI tool.');
  const unknown = providers.filter(
    (provider) => !(ADAPTER_TYPES as readonly string[]).includes(provider),
  );
  if (unknown.length > 0) {
    throw new JourneyRefusal(
      `Unknown AI tools: ${unknown.join(', ')}. Use: ${ADAPTER_TYPES.join(', ')}`,
    );
  }
  return [...new Set(providers)];
}

export function startRun(projectRoot: string, input: StartInput, now: Clock): JourneyRun {
  const at = now().toISOString();
  const run = createRun(projectRoot, {
    schema_version: 1,
    run_id: `onb-${randomUUID()}`,
    status: 'running',
    owner_session: input.session,
    providers: validateProviders(input.providers),
    allow_list: input.allowList,
    asked: input.asked,
    created_at: at,
    updated_at: at,
    stages: emptyStages(),
    written: {},
    setup_hashes: {},
    baseline: input.baseline,
  });
  appendChoice(projectRoot, {
    ts: at,
    run_id: run.run_id,
    stage: 'start',
    kind: 'providers',
    choice: run.providers.join(', '),
    reason:
      input.asked === 'tray'
        ? 'answered in the plugin tray'
        : 'the agent says the person answered the opening question',
    by: input.asked,
  });
  return run;
}

function defaultPlan(projectRoot: string, stage: StageId): string[] | undefined {
  if (stage === 'project_docs') return [...PROJECT_DOC_AREAS];
  if (stage === 'module_docs') {
    const units = readModuleUnits(projectRoot);
    return units ? [...units.map((unit) => unit.slug), MODULE_REGISTRIES_UNIT] : undefined;
  }
  return undefined;
}

export function startStage(
  projectRoot: string,
  stage: StageId,
  input: { planned?: number },
  now: Clock,
): JourneyRun {
  const run = requireRun(projectRoot);
  assertOpen(run);
  const gate = checkStartGate(run, stage);
  if (!gate.ok) throw new JourneyRefusal(gate.message);
  if (run.stages[stage].status !== 'not_started') {
    throw new JourneyRefusal(
      `Step ${stageDefinition(stage).index} (${stageDefinition(stage).name}) is already ${run.stages[stage].status}. Use \`onboarding resume\` to continue it.`,
    );
  }
  const at = now().toISOString();
  const plan = defaultPlan(projectRoot, stage);
  const saved = updateRun(
    projectRoot,
    (draft) => {
      draft.stages[stage] = {
        status: 'running',
        started_at: at,
        ...(plan ? { plan } : {}),
        ...(input.planned !== undefined ? { planned: input.planned } : {}),
      };
      draft.status = 'running';
      if (stage === 'rules_discovery') draft.rules_before = ruleIds(projectRoot);
    },
    { expectedRevision: run.revision, now },
  );
  appendEvent(projectRoot, { ts: at, run_id: run.run_id, kind: 'stage', stage, action: 'start' });
  return saved;
}

export function endStage(
  projectRoot: string,
  stage: StageId,
  degraded: readonly string[],
  now: Clock,
): JourneyRun {
  const run = requireRun(projectRoot);
  const gate = checkEndGate(
    { projectRoot, run, events: readEvents(projectRoot, run.run_id) },
    stage,
    degraded,
  );
  if (!gate.ok) throw new JourneyRefusal(gate.message);
  const at = now().toISOString();
  const flagged =
    stage === 'rule_scripts' ? flagJourneyRuleChecks(projectRoot, run.rules_before ?? []) : [];
  if (flagged.length > 0) {
    appendChoice(projectRoot, {
      ts: at,
      run_id: run.run_id,
      stage,
      kind: 'rule_checks_warn_only',
      choice: flagged.join(', '),
      reason: 'checks for rules the journey added only warn until a person reviews them',
      by: 'paqad-onboarding',
    });
  }
  const saved = updateRun(
    projectRoot,
    (draft) => {
      if (flagged.length > 0) draft.rule_checks_flagged = flagged;
      draft.stages[stage] = {
        ...draft.stages[stage],
        status: gate.degraded.length > 0 ? 'degraded' : 'done',
        ended_at: at,
        ...(gate.degraded.length > 0 ? { degraded: gate.degraded } : {}),
      };
    },
    { expectedRevision: run.revision, now },
  );
  appendEvent(projectRoot, {
    ts: at,
    run_id: run.run_id,
    kind: 'stage',
    stage,
    action: 'end',
    note: gate.degraded.join(',') || undefined,
  });
  return saved;
}

export function failStage(
  projectRoot: string,
  stage: StageId,
  reason: string,
  now: Clock,
): JourneyRun {
  const run = requireRun(projectRoot);
  if (run.stages[stage].status !== 'running') {
    throw new JourneyRefusal(
      `Step ${stageDefinition(stage).index} (${stageDefinition(stage).name}) is not running.`,
    );
  }
  if (reason.trim() === '') throw new JourneyRefusal('Say why the step failed (--reason).');
  const at = now().toISOString();
  const saved = updateRun(
    projectRoot,
    (draft) => {
      draft.stages[stage] = { ...draft.stages[stage], status: 'failed', failure: reason.trim() };
      draft.status = 'failed';
    },
    { expectedRevision: run.revision, now },
  );
  appendEvent(projectRoot, {
    ts: at,
    run_id: run.run_id,
    kind: 'stage',
    stage,
    action: 'fail',
    note: reason.trim(),
  });
  return saved;
}

function assertOpen(run: JourneyRun): void {
  if (run.status === 'done') throw new JourneyRefusal('This onboarding journey is finished.');
  if (run.status !== 'running') {
    throw new JourneyRefusal(
      `The journey is ${run.status}. Run \`paqad-ai onboarding resume\` first.`,
    );
  }
}

function assertRunning(run: JourneyRun, stage: StageId): void {
  assertOpen(run);
  if (run.stages[stage].status !== 'running') {
    throw new JourneyRefusal(
      `Step ${stageDefinition(stage).index} (${stageDefinition(stage).name}) is not running.`,
    );
  }
}

export interface UnitInput {
  outputs: string[];
  kept: boolean;
  sourceHash?: string;
}

function currentModuleHash(projectRoot: string, unit: string): string | undefined {
  return readModuleUnits(projectRoot)?.find((module) => module.slug === unit)?.source_hash;
}

export function recordUnit(
  projectRoot: string,
  stage: StageId,
  unit: string,
  input: UnitInput,
  now: Clock,
): JourneyRun {
  const run = requireRun(projectRoot);
  assertRunning(run, stage);
  if (unit.trim() === '') throw new JourneyRefusal('Name the unit that finished.');
  const sourceHash = stage === 'module_docs' ? currentModuleHash(projectRoot, unit) : undefined;
  if (input.kept) {
    if (stage !== 'module_docs' || sourceHash === undefined) {
      throw new JourneyRefusal('--kept is only for a module listed in module-map.yml.');
    }
    if (input.sourceHash !== sourceHash) {
      throw new JourneyRefusal(
        `Module "${unit}" changed since its docs were written, so it cannot be kept; write it again.`,
      );
    }
  }
  const outputs: Record<string, string> = {};
  for (const raw of input.outputs) {
    const rel = normalizeOutputPath(projectRoot, raw);
    const hash = fileSha256(join(projectRoot, rel));
    if (hash === null) throw new JourneyRefusal(`The output ${raw} does not exist.`);
    outputs[rel] = hash;
  }
  const at = now().toISOString();
  appendEvent(projectRoot, {
    ts: at,
    run_id: run.run_id,
    kind: input.kept ? 'unit_kept' : 'unit',
    stage,
    unit,
    outputs,
    ...(sourceHash !== undefined ? { source_hash: sourceHash } : {}),
  });
  if (Object.keys(outputs).length === 0) return run;
  return updateRun(
    projectRoot,
    (draft) => {
      draft.written = { ...draft.written, ...outputs };
    },
    { now },
  );
}

export function claimUnit(
  projectRoot: string,
  stage: StageId,
  unit: string,
  agent: string,
  now: Clock,
): void {
  const run = requireRun(projectRoot);
  assertRunning(run, stage);
  appendEvent(projectRoot, {
    ts: now().toISOString(),
    run_id: run.run_id,
    kind: 'agent_start',
    stage,
    unit,
    agent,
  });
}

export function recordProgress(
  projectRoot: string,
  stage: StageId,
  done: number,
  total: number,
  now: Clock,
): void {
  const run = requireRun(projectRoot);
  assertRunning(run, stage);
  if (!Number.isInteger(done) || !Number.isInteger(total) || done < 0 || total < done) {
    throw new JourneyRefusal('Progress needs whole numbers with done no larger than total.');
  }
  appendEvent(projectRoot, {
    ts: now().toISOString(),
    run_id: run.run_id,
    kind: 'progress',
    stage,
    done,
    total,
  });
}

export interface ResumeOutcome {
  run: JourneyRun;
  stage: StageId | null;
  units_todo: string[];
  handover: boolean;
}

export function resumeRun(projectRoot: string, session: string | null, now: Clock): ResumeOutcome {
  const run = requireRun(projectRoot);
  if (run.status === 'done')
    throw new JourneyRefusal('This onboarding journey is finished; there is nothing to resume.');
  const at = now().toISOString();
  const handover = session !== null && session !== run.owner_session;
  const current = foldJourney(run, readEvents(projectRoot, run.run_id), { now }).current;
  const modules = current === 'module_docs' ? readModuleUnits(projectRoot) : null;
  const saved = updateRun(
    projectRoot,
    (draft) => {
      draft.status = 'running';
      delete draft.abandoned_at;
      if (handover && session) draft.owner_session = session;
      if (current && draft.stages[current].status === 'failed') {
        draft.stages[current] = { ...draft.stages[current], status: 'running' };
        delete draft.stages[current].failure;
      }
      if (modules && current) {
        draft.stages[current] = {
          ...draft.stages[current],
          plan: [...modules.map((module) => module.slug), MODULE_REGISTRIES_UNIT],
        };
      }
    },
    { expectedRevision: run.revision, now },
  );
  if (handover) {
    appendEvent(projectRoot, {
      ts: at,
      run_id: run.run_id,
      kind: 'handover',
      session: session ?? undefined,
      note: `from ${run.owner_session}`,
    });
  }
  appendEvent(projectRoot, {
    ts: at,
    run_id: run.run_id,
    kind: 'stage',
    stage: current ?? undefined,
    action: 'resume',
  });
  const hashes = modules
    ? Object.fromEntries(modules.map((module) => [module.slug, module.source_hash]))
    : undefined;
  const todo = current
    ? foldStage(saved, readEvents(projectRoot, run.run_id), current, {
        currentSourceHashes: hashes,
      }).units_todo
    : [];
  return { run: saved, stage: current, units_todo: todo, handover };
}

export function abandonRun(projectRoot: string, now: Clock): { run: JourneyRun; kept: string[] } {
  const run = requireRun(projectRoot);
  if (run.status === 'done') throw new JourneyRefusal('This onboarding journey is finished.');
  const saved = updateRun(
    projectRoot,
    (draft) => {
      draft.status = 'abandoned';
      draft.abandoned_at = now().toISOString();
    },
    { expectedRevision: run.revision, now },
  );
  return { run: saved, kept: Object.keys(saved.written).sort() };
}

export function heartbeat(projectRoot: string, now: Clock): void {
  const run = readRun(projectRoot);
  if (run)
    appendEvent(projectRoot, { ts: now().toISOString(), run_id: run.run_id, kind: 'heartbeat' });
}
