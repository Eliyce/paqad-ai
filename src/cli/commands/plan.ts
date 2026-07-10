import { readFileSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import {
  NoActiveFeatureError,
  writeFeaturePlan,
  type PlanCompileInput,
} from '@/feature-evidence/artifacts.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

interface PlanCompileOptions {
  projectRoot: string;
  session?: string;
  keepInput?: boolean;
}

/**
 * `paqad-ai plan compile <input.json>` — compile the active feature's `plan.json`
 * (issue #339, Phase 3) from a filled template. The model fills a fixed JSON template
 * (`{ summary, steps, modules_touched, decisions, risks, title? }`); the script builds a
 * schema-validated `PlanRecord` with a deterministic `content_hash` and writes it into
 * the active feature's bundle — the model never owns the stored bytes. The transient
 * input is deleted after a successful compile (only the rigid JSON persists), unless
 * `--keep-input` is passed. Exits non-zero when no feature is active or the template is
 * malformed, with nothing written.
 */
export function createPlanCommand(): Command {
  const command = new Command('plan').description(
    'Work with the per-feature plan (compile the plan.json from a template)',
  );

  command
    .command('compile')
    .description('Compile the active feature plan.json from a filled JSON template')
    .argument('<input-file>', 'Path to the filled plan template (JSON)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .option('--keep-input', 'Keep the transient input file instead of deleting it', false)
    .action((inputFile: string, options: PlanCompileOptions) => {
      let template: PlanCompileInput;
      try {
        template = JSON.parse(readFileSync(inputFile, 'utf8')) as PlanCompileInput;
      } catch {
        console.error(`could not read/parse plan template "${inputFile}" (expected JSON)`);
        process.exitCode = 1;
        return;
      }
      if (typeof template.summary !== 'string' || template.summary.length === 0) {
        console.error('plan template needs a non-empty "summary"');
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
        result = writeFeaturePlan(root, sessionId, template);
      } catch (error) {
        console.error(
          error instanceof NoActiveFeatureError
            ? error.message
            : `could not compile plan: ${(error as Error).message}`,
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
          /* best-effort: a leftover template is harmless, never fail the compile for it */
        }
      }
      console.log(`▸ paqad · compiled ${result.path}`);
      console.log(JSON.stringify({ compiled: true, path: result.path }));
    });

  return command;
}
