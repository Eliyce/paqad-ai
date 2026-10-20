import { readFileSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import {
  NoActiveFeatureError,
  writeFeatureReview,
  type ReviewRecordInput,
} from '@/feature-evidence/artifacts.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { writeReviewDigest } from '@/review-digest/index.js';

interface ReviewRecordOptions {
  projectRoot: string;
  session?: string;
  keepInput?: boolean;
}

interface ReviewDigestOptions {
  projectRoot: string;
  session?: string;
}

const VERDICTS = ['safe-to-merge', 'needs-attention', 'inconclusive'] as const;

export function createReviewCommand(): Command {
  const command = new Command('review').description(
    'Work with the per-feature review (build the evidence digest, record the review.json)',
  );

  command
    .command('digest')
    .description('Compose the machine-built review evidence digest the review stage reads')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .action(async (options: ReviewDigestOptions) => {
      const sessionId = resolveSessionId(
        options.projectRoot,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      let result;
      try {
        result = await writeReviewDigest(options.projectRoot, sessionId);
      } catch (error) {
        console.error(`could not write the review digest: ${(error as Error).message}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `**▸ paqad** · ${result.path} — ${result.findings} machine finding(s) for the review to confirm or contest`,
      );
      console.log(JSON.stringify({ written: true, path: result.path, findings: result.findings }));
    });

  command
    .command('record')
    .description('Record the active feature review.json from a filled JSON template')
    .argument('<input-file>', 'Path to the filled review template (JSON)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .option('--keep-input', 'Keep the transient input file instead of deleting it', false)
    .action((inputFile: string, options: ReviewRecordOptions) => {
      let template: ReviewRecordInput;
      try {
        template = JSON.parse(readFileSync(inputFile, 'utf8')) as ReviewRecordInput;
      } catch {
        console.error(`could not read/parse review template "${inputFile}" (expected JSON)`);
        process.exitCode = 1;
        return;
      }
      if (typeof template.summary !== 'string' || template.summary.length === 0) {
        console.error('review template needs a non-empty "summary"');
        process.exitCode = 1;
        return;
      }
      if (!VERDICTS.includes(template.verdict)) {
        console.error(`review template needs a "verdict" of: ${VERDICTS.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      if (typeof template.rollback !== 'string' || template.rollback.length === 0) {
        console.error('review template needs a non-empty "rollback" (how to undo the change)');
        process.exitCode = 1;
        return;
      }
      const root = options.projectRoot;
      const sessionId = resolveSessionId(
        root,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      let result;
      try {
        result = writeFeatureReview(root, sessionId, template);
      } catch (error) {
        console.error(
          error instanceof NoActiveFeatureError
            ? error.message
            : `could not record review: ${(error as Error).message}`,
        );
        process.exitCode = 1;
        return;
      }
      if (!options.keepInput) {
        try {
          rmSync(inputFile, { force: true });
        } catch {}
      }
      console.log(`**▸ paqad** · recorded ${result.path}`);
      console.log(JSON.stringify({ recorded: true, path: result.path }));
    });

  return command;
}
