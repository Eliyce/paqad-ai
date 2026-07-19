import { readFileSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import {
  NoActiveFeatureError,
  writeFeatureReview,
  type ReviewRecordInput,
} from '@/feature-evidence/artifacts.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

interface ReviewRecordOptions {
  projectRoot: string;
  session?: string;
  keepInput?: boolean;
}

/** The verdict words the narration contract uses everywhere paqad speaks. */
const VERDICTS = ['safe-to-merge', 'needs-attention', 'inconclusive'] as const;

/**
 * `paqad-ai review record <input.json>` — write the active feature's `review.json`
 * (issue #402) from a filled template, the review stage's counterpart to
 * `paqad-ai plan compile`. Before this, `review` owned no rigid bundle file, so the
 * stage's evidence was a free-written `.md` with no defined home; the incident that
 * motivated this dropped `review-notes.md` straight into the bundle dir. The model
 * fills `{ summary, verdict, findings, checked, rollback, title? }`; the script builds
 * a schema-validated record with a deterministic `content_hash` and writes it into the
 * bundle, so the model never owns the stored bytes. The transient input is deleted
 * after a successful record (only the rigid JSON persists) unless `--keep-input` is
 * passed. Exits non-zero when no feature is active or the template is malformed, with
 * nothing written.
 */
export function createReviewCommand(): Command {
  const command = new Command('review').description(
    'Work with the per-feature review (record the review.json from a template)',
  );

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
      // Caught here as well as in the schema so the message names the allowed words
      // rather than surfacing a raw AJV enum error.
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
      // Transient scratch: the filled template is deleted so only the rigid JSON
      // persists — the input is never a second, editable source of truth.
      if (!options.keepInput) {
        try {
          rmSync(inputFile, { force: true });
        } catch {
          /* best-effort: a leftover template is harmless, never fail the record for it */
        }
      }
      console.log(`▸ paqad · recorded ${result.path}`);
      console.log(JSON.stringify({ recorded: true, path: result.path }));
    });

  return command;
}
