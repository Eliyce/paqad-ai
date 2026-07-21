import { readFileSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import {
  NoActiveFeatureError,
  ReuseDeclarationError,
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
 * (`{ summary, steps, modules_touched, decisions, risks, reuse, title? }`); the script
 * builds a schema-validated `PlanRecord` with a deterministic `content_hash` and writes it
 * into the active feature's bundle — the model never owns the stored bytes. The transient
 * input is deleted after a successful compile (only the rigid JSON persists), unless
 * `--keep-input` is passed. Exits non-zero when no feature is active or the template is
 * malformed, with nothing written.
 *
 * The `reuse` section is required (issue #357): the plan must record what existing code it
 * consulted, what it will reuse, and why anything new is justified, so it cannot quietly
 * rebuild something the project already has. Its checks are deterministic and cost no
 * model tokens — they cross-reference the code-knowledge index and the stack snapshot, and
 * degrade to a printed warning when either has not been built.
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
        // Issue #357 — a reuse-gate failure is the author's to fix, so its messages print
        // as-is (one per line) rather than wrapped in "could not compile plan": each line
        // already names the exact field and the edit that clears it.
        if (error instanceof ReuseDeclarationError) {
          for (const line of error.errors) {
            console.error(line);
          }
        } else {
          console.error(
            error instanceof NoActiveFeatureError
              ? error.message
              : `could not compile plan: ${(error as Error).message}`,
          );
        }
        process.exitCode = 1;
        return;
      }
      for (const warning of result.warnings ?? []) {
        console.warn(`▸ paqad · ${warning}`);
      }
      // Issue #361 — an evidence-armed pause blocks the next edit, so say so plainly rather
      // than letting the developer discover it as a mystery block.
      for (const decisionId of result.armedDecisions ?? []) {
        console.warn(
          `▸ paqad · I hit a reuse-or-create choice that's yours to make — answer ${decisionId} ` +
            `(\`npx paqad-ai decision resolve ${decisionId} <option>\`), then I'll continue.`,
        );
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
      console.log(
        JSON.stringify({
          compiled: true,
          path: result.path,
          ...(result.armedDecisions?.length ? { armed_decisions: result.armedDecisions } : {}),
        }),
      );
    });

  return command;
}
