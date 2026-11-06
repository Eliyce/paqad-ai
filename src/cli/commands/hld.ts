import { Command } from 'commander';

import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { changeLane } from '@/hld/applies.js';
import {
  runHldBrief,
  runHldCheck,
  runHldCheckApproval,
  runHldNotPosted,
  runHldPosted,
  runHldSkip,
  type HldContext,
  type HldResult,
} from '@/hld/verbs.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

interface CommonOptions {
  projectRoot: string;
  session?: string;
}

function context(options: CommonOptions): HldContext {
  const hint = options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
  const sessionId = resolveSessionId(options.projectRoot, hint);
  const dirName = currentFeature(options.projectRoot, sessionId);
  return {
    projectRoot: options.projectRoot,
    dirName,
    sessionId,
    lane: dirName ? changeLane(options.projectRoot, sessionId, dirName) : null,
  };
}

function emit(result: HldResult): void {
  if (result.exitCode === 0) console.log(result.output);
  else console.error(result.output);
  process.exitCode = result.exitCode;
}

function common(command: Command): Command {
  return command
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)');
}

export function createHldCommand(): Command {
  const command = new Command('hld').description(
    'Write, check, post and sign off the high-level design of a change',
  );

  common(
    command
      .command('brief')
      .description('Show what the high-level design needs and where it goes')
      .option('--text <text>', 'the ticket link or text the user pasted'),
  ).action((options: CommonOptions & { text?: string }) => {
    emit(runHldBrief(context(options), { text: options.text }));
  });

  common(
    command
      .command('check')
      .description('Check a high-level design for length, sections, code and jargon')
      .argument('<file>', 'the high-level design markdown file'),
  ).action((file: string, options: CommonOptions) => {
    emit(runHldCheck(context(options), file));
  });

  common(
    command
      .command('posted')
      .description('Record that the high-level design was posted')
      .requiredOption('--target <name>', 'the destination, like jira, ms-teams, slack or github')
      .requiredOption('--link <url>', 'the link to the post')
      .requiredOption('--id <id>', 'the comment or message id')
      .requiredOption('--at <time>', 'the time the destination shows for the post')
      .requiredOption('--author-id <id>', 'your own id on the destination')
      .requiredOption('--file <md>', 'the high-level design that was posted')
      .option('--ref <ref>', 'the ticket or channel name the team knows it by')
      .option('--detail-missing', 'the More detail part did not post')
      .option('--move-failed <why>', 'the ticket could not move'),
  ).action(
    (
      options: CommonOptions & {
        target: string;
        link: string;
        id: string;
        at: string;
        authorId: string;
        file: string;
        ref?: string;
        detailMissing?: boolean;
        moveFailed?: string;
      },
    ) => {
      emit(runHldPosted(context(options), options));
    },
  );

  common(
    command
      .command('not-posted')
      .description('Record that the high-level design could not be posted')
      .requiredOption('--target <name>', 'the destination that is not connected')
      .requiredOption('--file <md>', 'the high-level design')
      .option('--ref <ref>', 'the ticket or channel name the team knows it by'),
  ).action((options: CommonOptions & { target: string; file: string; ref?: string }) => {
    emit(runHldNotPosted(context(options), options));
  });

  common(
    command
      .command('check-approval')
      .description('Decide sign-off from the replies and status read from the destination')
      .requiredOption('--replies <file>', 'JSON replies saved under .paqad/tmp')
      .option('--status <status>', 'the ticket status now'),
  ).action((options: CommonOptions & { replies: string; status?: string }) => {
    emit(runHldCheckApproval(context(options), options));
  });

  common(
    command
      .command('skip')
      .description('Build before sign-off, with a reason the team will see')
      .requiredOption('--reason <why>', 'why the build starts before sign-off'),
  ).action((options: CommonOptions & { reason: string }) => {
    emit(runHldSkip(context(options), options));
  });

  return command;
}
