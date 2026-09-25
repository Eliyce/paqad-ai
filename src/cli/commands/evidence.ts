import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Command } from 'commander';

import {
  formatEvidenceMigration,
  migrateFeatureEvidence,
  migrationSessionId,
} from '@/feature-evidence/migrate.js';
import {
  readVerificationEvidence,
  renderEvidenceMarkdown,
} from '@/verification/evidence-markdown.js';

interface EvidenceCommandOptions {
  format: string;
  projectRoot: string;
  output?: string;
  failOnRed: boolean;
}

/**
 * `paqad-ai evidence [<sha>]` — render the persisted verification evidence
 * as a short, scannable PR comment (Markdown or JSON). Read-only: it surfaces
 * what verification already computed and persisted; it never computes, gates,
 * or signs. Pipe it to `gh pr comment --body-file` to erase the AI-PR
 * review-latency penalty with deterministic counter-evidence.
 */
export function createEvidenceCommand(): Command {
  const command = new Command('evidence')
    .description('Render verification evidence as a scannable PR comment (Markdown or JSON)')
    .argument('[sha]', 'Commit SHA or label shown in the headline')
    .option('--format <fmt>', 'Output format: markdown | json', 'markdown')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--output <path>', 'Write to a file instead of stdout (for gh pr comment --body-file)')
    .option('--fail-on-red', 'Exit non-zero when the overall status is fail', false)
    .action((sha: string | undefined, options: EvidenceCommandOptions) => {
      const projectRoot = resolve(options.projectRoot);
      const fmt = options.format.toLowerCase();
      if (fmt !== 'markdown' && fmt !== 'json') {
        process.stderr.write(
          `error: invalid --format value '${options.format}' (expected markdown or json)\n`,
        );
        process.exitCode = 2;
        return;
      }

      const evidence = readVerificationEvidence(projectRoot);
      if (evidence === null) {
        process.stderr.write(
          `evidence: no verification evidence found at ${projectRoot} — run verification first\n`,
        );
        process.exitCode = 4;
        return;
      }

      const output =
        fmt === 'json'
          ? JSON.stringify(evidence, null, 2)
          : renderEvidenceMarkdown(evidence, sha ? { sha } : {});

      if (options.output) {
        const target = resolve(options.output);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, `${output}\n`, 'utf8');
      } else {
        process.stdout.write(`${output}\n`);
      }

      if (options.failOnRed && evidence.overall_status === 'fail') {
        process.stderr.write('evidence: --fail-on-red tripped — overall status is fail\n');
        process.exitCode = 3;
      }
    });
  command.addCommand(createEvidenceMigrateCommand());
  return command;
}

/**
 * `paqad-ai evidence migrate [--dry-run]` (issue #581, FR-12) — move an existing project onto
 * the one-packet evidence layout. The silent update runs it once on its own; this is the same
 * migration by hand. `--dry-run` prints the plan and writes nothing.
 */
function createEvidenceMigrateCommand(): Command {
  return new Command('migrate')
    .description('Move old spec-pipeline runs into their change bundles (runs once on update)')
    .option('--dry-run', 'Print what would change and write nothing', false)
    .action((options: { dryRun: boolean }, command: Command) => {
      // `--project-root` belongs to the parent `evidence` command, which parses it wherever it
      // appears, so it is read from there rather than declared twice.
      const { projectRoot } = command.optsWithGlobals<{ projectRoot: string }>();
      const result = migrateFeatureEvidence(resolve(projectRoot), {
        dryRun: options.dryRun,
        sessionId: migrationSessionId(),
      });
      process.stdout.write(`${formatEvidenceMigration(result)}\n`);
      if (result.actions.some((action) => action.kind === 'failed')) {
        process.exitCode = 1;
      }
    });
}
