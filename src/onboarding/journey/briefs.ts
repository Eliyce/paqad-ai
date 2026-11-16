import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { getPackageRoot } from '@/core/runtime-paths.js';
import { fitToCeiling, type ContentSlot } from '@/stage-isolation/stage-begin.js';

import { readEvents } from './events.js';
import { foldJourney, type StageFold } from './fold.js';
import { readTextOrNull } from './io.js';
import { proveStage } from './proof.js';
import { readRun } from './run-store.js';
import { gitWorkflowHashes } from './setup.js';
import { STAGE_COUNT, stageDefinition, statusLine } from './stages.js';
import type { JourneyRun, StageDefinition, StageId } from './types.js';

export const BRIEF_CEILING = 27_000;
export const ANALYZE_BATCH = 25;
export const AUTO_SIGNAL = 'Onboarding journey says auto-recommended.';

export interface NextStep {
  done: boolean;
  stage: StageId | null;
  status_line: string | null;
  brief: string;
}

const POLICY = [
  `${AUTO_SIGNAL} Do not ask the person anything until the commit question at the end.`,
  'At every pause, take the recommended option with `paqad-ai onboarding decide <decision-id>`; it is recorded in choices.jsonl for review.',
  'Record each finished unit with `paqad-ai onboarding unit <step> <unit> --outputs <files>` as soon as it is done, so a stop keeps it.',
  'Never edit .paqad/onboarding/journey.json, .paqad/.config, .paqad/configs/ or a decision packet by hand.',
  'Existing project doc pages and existing rules stay as they are; only add what is missing.',
].join('\n- ');

export function installDir(projectRoot: string): string {
  return readTextOrNull(join(projectRoot, PATHS.FRAMEWORK_PATH))?.trim() || getPackageRoot();
}

function skillScripts(projectRoot: string, skill: string): string {
  return join(installDir(projectRoot), 'runtime/base/skills', skill, 'scripts');
}

export function gitWorkflowAnswersPath(): string {
  return join(tmpdir(), 'paqad-onboarding-git-workflow-answers.json');
}

function gitWorkflowLine(projectRoot: string, run: JourneyRun): string {
  const now = gitWorkflowHashes(projectRoot);
  const same =
    Object.keys(run.setup_hashes).length > 0 &&
    Object.entries(run.setup_hashes).every(([path, hash]) => now[path] === hash) &&
    Object.keys(now).length === Object.keys(run.setup_hashes).length;
  return same
    ? `Git workflow: the files are untouched since setup, so write the empty answers \`{}\` to ${gitWorkflowAnswersPath()} (outside the repo), apply the recommended workflow with \`paqad-ai git-workflow setup --apply ${gitWorkflowAnswersPath()} --overwrite\` and record each choice as not confirmed.`
    : 'Git workflow: the files changed since setup, so keep them as they are and do not run git-workflow setup.';
}

const SENTINEL_LINE =
  'After writing under docs/instructions/, read AGENT-BOOTSTRAP.md from the install directory again so the entry sentinel is stamped fresh.';

function stageWork(projectRoot: string, run: JourneyRun, stage: StageDefinition): string[] {
  const session = `Export SE_SESSION=${run.owner_session} for every paqad-ai command.`;
  switch (stage.id) {
    case 'detect':
      return [
        'Run `paqad-ai onboarding detect --json`.',
        'When it says needs_ai_choice, pick one stack from the candidates and run `paqad-ai onboarding choose-stack <stack> --capabilities <list> --reason "<one line>"`.',
      ];
    case 'setup':
      return [
        'Run `paqad-ai onboarding setup`. If it reports failed steps, fix the cause and run `paqad-ai onboarding setup --compile-only`.',
        'If setup kept hand-edited git-workflow files, end the step with `--degraded git_workflow_kept`.',
      ];
    case 'project_docs':
      return [
        session,
        `Dispatch the ${stage.agent} agent where agents exist (inline elsewhere) with the doc areas still to do. Follow documentation-workflow Stage 1 for each area; write only pages that are missing.`,
        gitWorkflowLine(projectRoot, run),
        'Accept the module map without a review stop; list low-confidence modules in the unit outputs.',
        'Before step 4, re-read docs/stack/ and docs/design-system/.',
        SENTINEL_LINE,
      ];
    case 'module_docs':
      return [
        session,
        `Dispatch up to 3 ${stage.agent} agents at a time, one module each; each writes only under docs/modules/<slug>/ and records \`paqad-ai onboarding unit module_docs <slug>\`.`,
        'After every module, rebuild the registries and doc-progress.json once, then record `paqad-ai onboarding unit module_docs registries`.',
      ];
    case 'rules_discovery':
      return [
        session,
        'Run `paqad-ai rules discovery start` (use --fresh for a stale or broken run) and follow the rules-discovery steps. With no network, research offline and end with `--degraded research_offline`.',
        'Record each researched package with `paqad-ai onboarding unit rules_discovery <package>`.',
        'Review with `paqad-ai rules discovery review --run <run_id> --all-recommended`, then answer the sign-off with `paqad-ai onboarding decide <decision-id>`.',
        'If research stops before every package, end with `--degraded research_stopped`.',
        SENTINEL_LINE,
      ];
    case 'rules_analyze':
      return [
        session,
        `Run the rule analyzer scripts from ${skillScripts(projectRoot, 'rule-analyzer')}. Classify in batches of ${ANALYZE_BATCH} and run \`paqad-ai onboarding progress rules_analyze <done> <total>\` after each batch.`,
        'On a conflict, keep the existing rule and mark the newer one unverifiable with the reason "onboarding: conflict kept existing".',
      ];
    case 'rule_scripts':
      return [
        session,
        `Write each check with the rule-script-generator scripts in ${skillScripts(projectRoot, 'rule-script-generator')}; install it only through register-script.mjs there.`,
        'A failing fixture is regenerated once, then the rule is marked unverifiable with "onboarding: fixtures failed".',
        'Record each rule batch with `paqad-ai onboarding unit rule_scripts <batch>`, then run `paqad-ai rules compile`.',
      ];
    case 'finish':
      return [
        'Run `paqad-ai onboarding finish`, then ask the person the commit question exactly once.',
      ];
  }
}

function unitsLine(stage: StageDefinition, fold: StageFold): string {
  if (!stage.unit) return '';
  if (fold.units_todo.length === 0) return `No ${stage.unit.many} are listed yet.`;
  return `${stage.unit.many} still to do, first first:\n- ${fold.units_todo.join('\n- ')}`;
}

function proofLine(projectRoot: string, run: JourneyRun, stage: StageId): string {
  if (run.stages[stage].status !== 'running') return '';
  const missing = proveStage(
    { projectRoot, run, events: readEvents(projectRoot, run.run_id) },
    stage,
  )
    .filter((item) => !item.ok)
    .map((item) => `${item.item}: ${item.message}`);
  return missing.length === 0
    ? 'Proof is complete.'
    : `Proof still missing:\n- ${missing.join('\n- ')}`;
}

function callbacks(stage: StageDefinition): string {
  const gaps =
    stage.allowed_degraded.length > 0 ? ` Allowed gaps: ${stage.allowed_degraded.join(', ')}.` : '';
  return [
    `When the work is done: \`paqad-ai onboarding stage end ${stage.id}\`.${gaps}`,
    `When it cannot go on: \`paqad-ai onboarding stage fail ${stage.id} --reason "<why>"\`, then stop.`,
    'Then run `paqad-ai onboarding next` again in the same turn.',
  ].join('\n');
}

export function renderBrief(projectRoot: string, run: JourneyRun, fold: StageFold): string {
  const stage = stageDefinition(fold.id);
  const record = run.stages[stage.id];
  const header = [
    statusLine(stage.id, fold.total !== null ? `${fold.done} of ${fold.total}` : undefined),
    `Step ${stage.index} of ${STAGE_COUNT}: ${stage.name} (${stage.workflow}).`,
    record.status === 'not_started'
      ? `Start it with \`paqad-ai onboarding stage start ${stage.id}\`.`
      : `It is ${record.status}.`,
    `Policy:\n- ${POLICY}`,
    `Work:\n- ${stageWork(projectRoot, run, stage).join('\n- ')}`,
  ].join('\n\n');
  const slots: ContentSlot[] = [
    { name: 'request', full: header, kept: header.length },
    { name: 'units', full: unitsLine(stage, fold), kept: unitsLine(stage, fold).length },
    {
      name: 'proof',
      full: proofLine(projectRoot, run, stage.id),
      kept: proofLine(projectRoot, run, stage.id).length,
    },
  ];
  const tail = callbacks(stage);
  const content = fitToCeiling(
    slots,
    (fit) => fit.request.length + Object.values(fit.pillars).join('\n\n').length + tail.length + 8,
    BRIEF_CEILING,
  );
  return [content.request, ...Object.values(content.pillars), tail]
    .filter((part) => part !== '')
    .join('\n\n');
}

export function nextStep(projectRoot: string, now: () => Date): NextStep {
  const run = readRun(projectRoot);
  if (!run) {
    return {
      done: false,
      stage: null,
      status_line: null,
      brief: 'Run `paqad-ai onboarding start` first.',
    };
  }
  const fold = foldJourney(run, readEvents(projectRoot, run.run_id), { now });
  if (fold.current === null) {
    return {
      done: true,
      stage: null,
      status_line: null,
      brief: run.commit
        ? 'The journey is done.'
        : 'Every step is done. Ask "Commit these changes on a new branch?" exactly once and answer with `paqad-ai onboarding commit --branch <name>`, `--later` or `--no`.',
    };
  }
  return {
    done: false,
    stage: fold.current,
    status_line: statusLine(fold.current),
    brief: renderBrief(projectRoot, run, fold.stages[fold.current]),
  };
}
