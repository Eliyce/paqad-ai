import { Command } from 'commander';

import {
  abandonReview,
  finishReview,
  findingReview,
  gapReview,
  resumeReview,
  reviewKind,
  stageReview,
  startReview,
  type StageVerb,
} from '@/review-runs/actions.js';
import { ReviewRefusal } from '@/review-runs/errors.js';
import type { ReviewKind, ReviewKindId } from '@/review-runs/kinds.js';
import { readReviewRun } from '@/review-runs/store.js';
import type { ReviewRun } from '@/review-runs/types.js';
import { buildReviewView } from '@/review-runs/view.js';

export const REVIEW_RUN_VERBS = [
  'start',
  'stage',
  'finding',
  'gap',
  'finish',
  'abandon',
  'resume',
  'status',
] as const;

const STAGE_VERBS: readonly StageVerb[] = ['start', 'done', 'skip'];

interface RootOptions {
  projectRoot: string;
  json?: boolean;
}

export interface ReviewRunCommandDeps {
  now?: () => Date;
}

function rootOption(command: Command): Command {
  return command
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Print one JSON object');
}

function report(kind: ReviewKind, run: ReviewRun | null, options: RootOptions, now: () => Date) {
  const view = run === null ? null : buildReviewView(kind, run, { now });
  if (options.json) {
    console.log(JSON.stringify({ ok: true, kind: kind.id, run, view }));
    return;
  }
  console.log(view === null ? `${kind.word}: none open` : `${kind.word}: ${view.headline.text}`);
}

function refuse(options: RootOptions, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split('\n')[0] ?? message;
  if (options.json) console.log(JSON.stringify({ ok: false, refusal: line }));
  else console.error(line);
  process.exitCode = 1;
}

function run(
  kind: ReviewKind,
  options: RootOptions,
  now: () => Date,
  work: () => ReviewRun | null,
): void {
  try {
    report(kind, work(), options, now);
  } catch (error) {
    refuse(options, error);
  }
}

function stageVerb(value: string): StageVerb {
  if (!STAGE_VERBS.includes(value as StageVerb)) {
    throw new ReviewRefusal(`The stage verb must be one of ${STAGE_VERBS.join(', ')}.`);
  }
  return value as StageVerb;
}

export function createReviewRunCommand(id: ReviewKindId, deps: ReviewRunCommandDeps = {}): Command {
  const kind = reviewKind(id);
  const now = deps.now ?? (() => new Date());
  const write = { now };
  const command = new Command(kind.verb).description(
    `Record the ${kind.word.toLowerCase()} stages, findings and gaps for the HUD`,
  );
  rootOption(command.command('start').description(`Start a ${kind.word.toLowerCase()} run`)).action(
    (options: RootOptions) =>
      run(kind, options, now, () => startReview(options.projectRoot, kind, write)),
  );
  rootOption(
    command
      .command('stage')
      .description('Start, finish or skip one stage')
      .argument('<id>', kind.stages.map((stage) => stage.id).join(' | '))
      .argument('<verb>', STAGE_VERBS.join(' | ')),
  ).action((stage: string, verb: string, options: RootOptions) =>
    run(kind, options, now, () =>
      stageReview(options.projectRoot, kind, stage, stageVerb(verb), write),
    ),
  );
  rootOption(command.command('finding').description('Record one finding'))
    .option('--severity <level>', 'critical | high | medium | low | info')
    .option('--proof <proof>', 'confirmed | lead')
    .option('--id <id>', `The finding id (${kind.prefix}…)`)
    .action((options: RootOptions & { severity?: string; proof?: string; id?: string }) =>
      run(kind, options, now, () =>
        findingReview(
          options.projectRoot,
          kind,
          { severity: options.severity, proof: options.proof, id: options.id ?? null },
          write,
        ),
      ),
    );
  rootOption(command.command('gap').description('Record one gap on a stage').argument('<code>'))
    .option('--stage <id>', 'The stage the gap belongs to')
    .option('--say <words>', 'What the gap is, in plain words')
    .option('--stop', 'Stop the run at this stage', false)
    .action(
      (code: string, options: RootOptions & { stage?: string; say?: string; stop?: boolean }) =>
        run(kind, options, now, () =>
          gapReview(
            options.projectRoot,
            kind,
            { code, stage: options.stage, say: options.say, stop: options.stop === true },
            write,
          ),
        ),
    );
  rootOption(command.command('finish').description('Finish the run')).action(
    (options: RootOptions) =>
      run(kind, options, now, () => finishReview(options.projectRoot, kind, write)),
  );
  rootOption(command.command('abandon').description('Abandon the open run')).action(
    (options: RootOptions) =>
      run(kind, options, now, () => abandonReview(options.projectRoot, kind, write)),
  );
  rootOption(command.command('resume').description('Resume a stopped or abandoned run')).action(
    (options: RootOptions) =>
      run(kind, options, now, () => resumeReview(options.projectRoot, kind, write)),
  );
  rootOption(command.command('status').description('Show where the run is')).action(
    (options: RootOptions) =>
      run(kind, options, now, () => readReviewRun(options.projectRoot, kind)),
  );
  return command;
}
