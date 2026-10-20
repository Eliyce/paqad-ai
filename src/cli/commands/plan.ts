import { readFileSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import {
  NoActiveFeatureError,
  ReuseDeclarationError,
  writeFeaturePlan,
  type PlanCompileInput,
} from '@/feature-evidence/artifacts.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

interface PlanCompileOptions {
  projectRoot: string;
  session?: string;
  keepInput?: boolean;
}

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
    .action(async (inputFile: string, options: PlanCompileOptions) => {
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
      const changedFiles = (await loadChangeEvidence(root)).files;
      let result;
      try {
        result = writeFeaturePlan(root, sessionId, template, { changedFiles });
      } catch (error) {
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
        console.warn(`**▸ paqad** · ${warning}`);
      }
      for (const decisionId of result.armedDecisions ?? []) {
        console.warn(
          `**▸ paqad** · I hit a reuse-or-create choice that's yours to make — answer ${decisionId} ` +
            `(\`paqad-ai decision resolve ${decisionId} <option>\`), then I'll continue.`,
        );
      }
      if (result.readinessDecision) {
        const id = result.readinessDecision;
        console.warn(
          `**▸ paqad** · Visual evidence is on, but I can't capture screenshots here yet. Answer ${id} ` +
            `(\`paqad-ai decision resolve ${id} setup|attach|waive\`), then I'll continue.`,
        );
      }
      if (!options.keepInput) {
        try {
          rmSync(inputFile, { force: true });
        } catch {}
      }
      console.log(`**▸ paqad** · compiled ${result.path}`);
      console.log(
        JSON.stringify({
          compiled: true,
          path: result.path,
          ...(result.armedDecisions?.length ? { armed_decisions: result.armedDecisions } : {}),
          ...(result.readinessDecision ? { readiness_decision: result.readinessDecision } : {}),
        }),
      );
    });

  return command;
}
