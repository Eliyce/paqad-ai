import { readFileSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import {
  NoActiveFeatureError,
  writeFeatureReview,
  type ReviewRecordInput,
} from '@/feature-evidence/artifacts.js';
import { activeChangeFiles } from '@/pipeline/change-evidence.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { writeReviewDigest } from '@/review-digest/index.js';
import { collectMachineFindings, scopeFindingsToChange } from '@/review-digest/sources.js';
import { stageLedgerEra } from '@/stage-evidence/ledger-era.js';
import { checkRecipe } from '@/stage-isolation/recipe-check.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';

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

function judgmentOnlyRefusal(
  root: string,
  sessionId: string,
  template: ReviewRecordInput,
): string | null {
  const findings = Array.isArray(template.findings) ? template.findings : [];
  if (findings.length === 0) return null;
  const dirName = currentFeature(root, sessionId);
  if (dirName === null) return null;
  if (stageLedgerEra(readFeatureStageUnit(root, dirName), 'review') !== 'v3') return null;
  const rows = scopeFindingsToChange(
    collectMachineFindings(root),
    activeChangeFiles(root, sessionId),
    root,
  ).filter((row) => row.tier === 'deterministic');
  if (rows.length === 0) return null;
  const cited = findings.some((finding) =>
    rows.some(
      (row) =>
        (row.file !== null &&
          (finding.file === row.file || finding.description?.includes(row.file))) ||
        finding.description?.includes(row.source),
    ),
  );
  return cited
    ? null
    : '**▸ paqad** · every finding is judgment, but the digest has machine rows. Confirm or contest them: cite a row by its file or source.';
}

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
      const recipeCheck = checkRecipe({
        projectRoot: root,
        sessionId,
        stage: 'review',
        args: [inputFile],
      });
      for (const line of recipeCheck.lines) console.error(line);
      if (recipeCheck.verdict === 'refuse') {
        process.exitCode = 1;
        return;
      }
      const judgment = judgmentOnlyRefusal(root, sessionId, template);
      if (judgment !== null) {
        console.error(judgment);
        process.exitCode = 1;
        return;
      }
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
      recipeCheck.record();
      console.log(`**▸ paqad** · recorded ${result.path}`);
      console.log(JSON.stringify({ recorded: true, path: result.path }));
    });

  return command;
}
