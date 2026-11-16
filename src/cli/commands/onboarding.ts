import { Command } from 'commander';

import { getPackageRoot } from '@/core/runtime-paths.js';
import {
  abandonRun,
  claimUnit,
  endStage,
  failStage,
  heartbeat,
  recordProgress,
  recordUnit,
  resumeRun,
  startRun,
  startStage,
} from '@/onboarding/journey/actions.js';
import { autoDecide } from '@/onboarding/journey/auto-decide.js';
import { answerCommit, type CommitAnswer } from '@/onboarding/journey/commit.js';
import { finishJourney, rebuildRagInBackground } from '@/onboarding/journey/finish.js';
import { nextStep } from '@/onboarding/journey/briefs.js';
import { appendChoice, readChoices } from '@/onboarding/journey/choices.js';
import { chooseStack, detectProject } from '@/onboarding/journey/detect.js';
import { JourneyRefusal } from '@/onboarding/journey/errors.js';
import { writeAllowList } from '@/onboarding/journey/permissions.js';
import { runPreflight } from '@/onboarding/journey/preflight.js';
import { reviewChoices } from '@/onboarding/journey/rule-checks.js';
import { applySetupStage } from '@/onboarding/journey/setup.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';
import { requireRun, updateRun } from '@/onboarding/journey/run-store.js';
import { isStageId } from '@/onboarding/journey/stages.js';
import type { StageId } from '@/onboarding/journey/types.js';
import { writeView } from '@/onboarding/journey/view.js';

export const ONBOARDING_VERBS = [
  'start',
  'detect',
  'choose-stack',
  'setup',
  'next',
  'stage',
  'unit',
  'progress',
  'decide',
  'status',
  'choices',
  'resume',
  'finish',
  'commit',
  'abandon',
] as const;

interface RootOptions {
  projectRoot: string;
  json?: boolean;
}

const now = (): Date => new Date();

function emit(options: RootOptions, value: unknown, text: string): void {
  console.log(options.json ? JSON.stringify(value, null, 2) : text);
}

export async function runVerb(
  projectRoot: string,
  work: () => Promise<void> | void,
): Promise<void> {
  try {
    await work();
    writeView(projectRoot, { now });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`**▸ paqad** · ${message}`);
    process.exitCode = 1;
    try {
      writeView(projectRoot, { now, refusal: message });
    } catch (viewError) {
      console.error(`could not update the onboarding view: ${(viewError as Error).message}`);
    }
  }
}

function stageArg(value: string): StageId {
  if (!isStageId(value)) throw new JourneyRefusal(`Unknown step "${value}".`);
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function rootOption(command: Command): Command {
  return command
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Print JSON');
}

interface StartOptions extends RootOptions {
  providers?: string;
  session?: string;
  allowList: string;
  asked?: boolean;
  fromTray?: boolean;
}

async function startVerb(options: StartOptions): Promise<void> {
  const root = options.projectRoot;
  const session =
    options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? 'unknown';
  const preflight = runPreflight(root, {
    asked: options.asked === true,
    fromTray: options.fromTray === true,
    isTTY: process.stdin.isTTY === true,
  });
  if (preflight.kind === 'refused') throw new JourneyRefusal(preflight.message);
  if (preflight.kind === 'attach') {
    const resumed = resumeRun(root, session, now);
    emit(
      options,
      { attached: true, ...resumed },
      `**▸ paqad** · An onboarding journey is already open here; resumed it at ${resumed.stage ?? 'the end'}.`,
    );
    return;
  }
  const allowList = options.allowList !== 'no';
  const run = startRun(
    root,
    {
      providers: list(options.providers ?? 'claude-code'),
      session,
      allowList,
      asked: options.fromTray ? 'tray' : 'agent-attested',
      baseline: preflight.baseline,
    },
    now,
  );
  if (allowList) {
    const result = writeAllowList(root, getPackageRoot());
    appendChoice(root, {
      ts: now().toISOString(),
      run_id: run.run_id,
      stage: 'start',
      kind: 'allow_list',
      choice: 'let it work without stopping to ask',
      reason: `remove the added entries from ${result.path} to undo it`,
      by: run.asked,
      details: { added: result.added, ignore_line_added: result.ignore_line_added },
    });
  }
  emit(options, run, `**▸ paqad** · Onboarding started for ${run.providers.join(', ')}.`);
}

function addStart(command: Command): void {
  rootOption(
    command.command('start').description('Start the onboarding journey after the opening question'),
  )
    .option('--providers <list>', 'Comma-separated AI tools the team uses', 'claude-code')
    .option('--session <id>', 'The session that owns the journey')
    .option(
      '--allow-list <yes|no>',
      'Write the local allow list so the journey works without stopping to ask',
      'yes',
    )
    .option('--asked', 'The agent asked the person the opening question')
    .option('--from-tray', 'The plugin tray recorded the answer')
    .action((options: StartOptions) => runVerb(options.projectRoot, () => startVerb(options)));
}

function addDetect(command: Command): void {
  rootOption(
    command.command('detect').description('Step 1: read the project and record the stack'),
  ).action((options: RootOptions) =>
    runVerb(options.projectRoot, async () => {
      const root = options.projectRoot;
      const outcome = await detectProject(root, now());
      const detection = outcome.detection;
      if (detection) updateRun(root, (draft) => void (draft.detection = detection), { now });
      emit(
        options,
        outcome,
        outcome.needs_ai_choice
          ? '**▸ paqad** · The stack is unclear. Pick one with `paqad-ai onboarding choose-stack <stack> --reason "<why>"`.'
          : `**▸ paqad** · Detected ${detection?.stack}.`,
      );
    }),
  );
}

interface ChooseOptions extends RootOptions {
  capabilities?: string;
  reason: string;
}

function addChooseStack(command: Command): void {
  rootOption(
    command.command('choose-stack').description('Step 1: record the AI stack pick and why'),
  )
    .argument('<stack>')
    .option('--capabilities <list>', 'Comma-separated capabilities')
    .option('--reason <text>', 'One line on why this stack fits', '')
    .action((stack: string, options: ChooseOptions) =>
      runVerb(options.projectRoot, () => {
        const root = options.projectRoot;
        const run = requireRun(root);
        const detection = chooseStack(
          run,
          { stack, capabilities: list(options.capabilities), reason: options.reason },
          now(),
        );
        updateRun(root, (draft) => void (draft.detection = detection), {
          expectedRevision: run.revision,
          now,
        });
        appendChoice(root, {
          ts: detection.detected_at,
          run_id: run.run_id,
          stage: 'detect',
          kind: 'stack',
          choice: detection.stack,
          reason: detection.reason,
          by: 'paqad-onboarding',
          details: { capabilities: detection.capabilities },
        });
        emit(options, detection, `**▸ paqad** · Stack set to ${detection.stack}.`);
      }),
    );
}

function addSetup(command: Command): void {
  rootOption(command.command('setup').description('Step 2: set up paqad without questions'))
    .option('--compile-only', 'Only re-run the rule compile steps after a compile failure')
    .action((options: RootOptions & { compileOnly?: boolean }) =>
      runVerb(options.projectRoot, async () => {
        const setup = await applySetupStage(
          options.projectRoot,
          { compileOnly: options.compileOnly === true, runner: new OnboardingOrchestrator() },
          now,
        );
        emit(
          options,
          setup,
          `**▸ paqad** · Set up paqad: ${setup.generated_files.length} files, ${setup.step_failures.length} failed step(s).`,
        );
      }),
    );
}

function addStage(command: Command): void {
  const stage = command.command('stage').description('Start, end or fail a step');
  rootOption(stage.command('start').argument('<step>'))
    .option('--planned <count>', 'Planned unit count when only a count is known')
    .action((step: string, options: RootOptions & { planned?: string }) =>
      runVerb(options.projectRoot, () => {
        const planned = options.planned === undefined ? undefined : Number(options.planned);
        const run = startStage(options.projectRoot, stageArg(step), { planned }, now);
        emit(options, run.stages[stageArg(step)], `**▸ paqad** · Started ${step}.`);
      }),
    );
  rootOption(stage.command('end').argument('<step>'))
    .option('--degraded <codes>', 'Comma-separated gap codes allowed for this step')
    .action((step: string, options: RootOptions & { degraded?: string }) =>
      runVerb(options.projectRoot, () => {
        const run = endStage(options.projectRoot, stageArg(step), list(options.degraded), now);
        emit(options, run.stages[stageArg(step)], `**▸ paqad** · Ended ${step}.`);
      }),
    );
  rootOption(stage.command('fail').argument('<step>'))
    .option('--reason <text>', 'Why the step failed', '')
    .action((step: string, options: RootOptions & { reason: string }) =>
      runVerb(options.projectRoot, () => {
        failStage(options.projectRoot, stageArg(step), options.reason, now);
        emit(
          options,
          { failed: step },
          `**▸ paqad** · Step ${step} stopped. Run \`paqad-ai onboarding resume\` to continue.`,
        );
      }),
    );
}

function addUnit(command: Command): void {
  rootOption(
    command
      .command('unit')
      .description('Record one finished unit of a step')
      .argument('<step>')
      .argument('<unit>'),
  )
    .option('--outputs <paths>', 'Comma-separated files the unit wrote')
    .option('--kept', 'Keep a module whose source is unchanged since its docs were written')
    .option('--source-hash <sha>', 'The module source hash a kept unit matches')
    .option('--claim <agent>', 'Record that an agent starts this unit, before dispatching it')
    .action(
      (
        step: string,
        unit: string,
        options: RootOptions & {
          outputs?: string;
          kept?: boolean;
          sourceHash?: string;
          claim?: string;
        },
      ) =>
        runVerb(options.projectRoot, () => {
          if (options.claim) {
            claimUnit(options.projectRoot, stageArg(step), unit, options.claim, now);
            emit(options, { step, unit }, `**▸ paqad** · ${options.claim} starts ${unit}.`);
            return;
          }
          recordUnit(
            options.projectRoot,
            stageArg(step),
            unit,
            {
              outputs: list(options.outputs),
              kept: options.kept === true,
              sourceHash: options.sourceHash,
            },
            now,
          );
          emit(options, { step, unit }, `**▸ paqad** · Recorded ${unit}.`);
        }),
    );
}

function addProgress(command: Command): void {
  rootOption(
    command
      .command('progress')
      .description('Record batch progress for a step')
      .argument('<step>')
      .argument('<done>')
      .argument('<total>'),
  ).action((step: string, done: string, total: string, options: RootOptions) =>
    runVerb(options.projectRoot, () => {
      recordProgress(options.projectRoot, stageArg(step), Number(done), Number(total), now);
      emit(
        options,
        { step, done: Number(done), total: Number(total) },
        `**▸ paqad** · ${done} of ${total}.`,
      );
    }),
  );
}

function addNext(command: Command): void {
  rootOption(command.command('next').description('Print what to do next')).action(
    (options: RootOptions) =>
      runVerb(options.projectRoot, () => {
        heartbeat(options.projectRoot, now);
        const step = nextStep(options.projectRoot, now);
        emit(options, step, [step.status_line, step.brief].filter(Boolean).join('\n'));
      }),
  );
}

function addDecide(command: Command): void {
  rootOption(
    command
      .command('decide')
      .description('Answer a decision the journey opened with its recommended option')
      .argument('<id>'),
  ).action((id: string, options: RootOptions) =>
    runVerb(options.projectRoot, () => {
      const decided = autoDecide(options.projectRoot, id, now);
      emit(
        options,
        decided,
        `**▸ paqad** · ${id} answered with ${decided.chosen_option_key} (recorded as ${decided.choice.id}).`,
      );
    }),
  );
}

function addStatus(command: Command): void {
  rootOption(command.command('status').description('Show where the journey is')).action(
    (options: RootOptions) =>
      runVerb(options.projectRoot, () => {
        const view = writeView(options.projectRoot, { now });
        emit(options, view, [view.headline.text, view.alt].join('\n'));
      }),
  );
}

function addChoices(command: Command): void {
  rootOption(
    command.command('choices').description('List automatic choices, or mark them reviewed'),
  )
    .option('--review [ids]', 'Mark choices reviewed (comma-separated ids, or all)')
    .action((options: RootOptions & { review?: string | boolean }) =>
      runVerb(options.projectRoot, () => {
        const root = options.projectRoot;
        if (options.review !== undefined) {
          const ids =
            options.review === true || options.review === 'all'
              ? 'all'
              : list(String(options.review));
          const marked = reviewChoices(root, ids, now);
          emit(options, marked, `**▸ paqad** · Marked ${marked.length} choice(s) reviewed.`);
          return;
        }
        const rows = readChoices(root);
        emit(
          options,
          rows,
          rows
            .map(
              (row) =>
                `${row.id} ${row.reviewed ? '✓' : '○'} ${row.stage} · ${row.kind}: ${row.choice} (${row.reason})`,
            )
            .join('\n') || 'No choices recorded.',
        );
      }),
    );
}

function addFinish(command: Command): void {
  rootOption(
    command
      .command('finish')
      .description('Step 8: build search, write the report and end the step'),
  ).action((options: RootOptions) =>
    runVerb(options.projectRoot, () => {
      const report = finishJourney(options.projectRoot, { rag: rebuildRagInBackground }, now);
      emit(
        options,
        report,
        `**▸ paqad** · Onboarding finished. Report: .paqad/onboarding/report.md. Ask: "Commit these changes on a new branch?"`,
      );
    }),
  );
}

interface CommitOptions extends RootOptions {
  branch?: string | boolean;
  later?: boolean;
  no?: boolean;
  ticket?: string;
  message?: string;
}

function commitAnswerOf(options: CommitOptions): CommitAnswer {
  const given = [options.branch !== undefined, options.later === true, options.no === true].filter(
    Boolean,
  );
  if (given.length !== 1) {
    throw new JourneyRefusal(
      "Pass the person's answer: exactly one of --branch [name], --later or --no.",
    );
  }
  if (options.later) return { kind: 'later' };
  if (options.no) return { kind: 'no' };
  return {
    kind: 'branch',
    branch: typeof options.branch === 'string' ? options.branch : true,
    ...(options.ticket ? { ticket: options.ticket } : {}),
    ...(options.message ? { message: options.message } : {}),
  };
}

function addCommit(command: Command): void {
  rootOption(
    command.command('commit').description("Record the person's answer to the commit question"),
  )
    .option(
      '--branch [name]',
      'Commit on a new branch (the name follows branches.yaml when omitted)',
    )
    .option('--later', 'Leave the changes uncommitted for now')
    .option('--no', 'Do not commit')
    .option('--ticket <id>', 'Ticket for the branch and commit names')
    .option('--message <subject>', 'Commit subject when the team pattern needs one')
    .action((options: CommitOptions) =>
      runVerb(options.projectRoot, () => {
        const record = answerCommit(options.projectRoot, commitAnswerOf(options), now);
        const left =
          record.left_out?.map((item) => `  left out: ${item.path} (${item.reason})`) ?? [];
        emit(
          options,
          record,
          record.answer === 'branch'
            ? [
                `**▸ paqad** · Committed ${record.committed?.length ?? 0} files on ${record.branch}. Nothing was pushed.`,
                ...left,
              ].join('\n')
            : '**▸ paqad** · Changes left uncommitted. Commit them later with `paqad-ai onboarding commit --branch`.',
        );
      }),
    );
}

function addResume(command: Command): void {
  rootOption(
    command.command('resume').description('Resume a stopped, paused or interrupted journey'),
  )
    .option('--session <id>', 'The session taking over the journey')
    .action((options: RootOptions & { session?: string }) =>
      runVerb(options.projectRoot, () => {
        const session = options.session ?? process.env.SE_SESSION ?? null;
        const outcome = resumeRun(options.projectRoot, session, now);
        emit(
          options,
          outcome,
          `**▸ paqad** · Resumed at ${outcome.stage ?? 'the end'}${outcome.units_todo[0] ? `, starting with ${outcome.units_todo[0]}` : ''}.`,
        );
      }),
    );
}

function addAbandon(command: Command): void {
  rootOption(
    command.command('abandon').description('Pause the journey and keep everything written so far'),
  ).action((options: RootOptions) =>
    runVerb(options.projectRoot, () => {
      const outcome = abandonRun(options.projectRoot, now);
      emit(
        options,
        outcome,
        [
          `**▸ paqad** · Onboarding paused. Everything written so far stays; review it:`,
          ...outcome.kept.map((path) => `  ${path}`),
        ].join('\n'),
      );
    }),
  );
}

export function createOnboardingCommand(): Command {
  const command = new Command('onboarding').description(
    'Run the onboarding journey step by step (driven by an AI tool)',
  );
  addStart(command);
  addDetect(command);
  addChooseStack(command);
  addSetup(command);
  addNext(command);
  addStage(command);
  addUnit(command);
  addProgress(command);
  addDecide(command);
  addStatus(command);
  addChoices(command);
  addFinish(command);
  addCommit(command);
  addResume(command);
  addAbandon(command);
  return command;
}
