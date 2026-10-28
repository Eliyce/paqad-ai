import { readFileSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import {
  NoActiveFeatureError,
  ReuseDeclarationError,
  writeFeaturePlan,
  type PlanCompileInput,
} from '@/feature-evidence/artifacts.js';
import { readChangeStartPoint } from '@/feature-evidence/delivery.js';
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import {
  fixProofMethodLine,
  raiseFixProofMethodDecision,
  type RaiseFixProofMethodResult,
} from '@/fix-protocol/fix-proof-method-decision.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { questionRoundAhead } from '@/spec-pipeline/round.js';

interface PlanCompileOptions {
  projectRoot: string;
  session?: string;
  keepInput?: boolean;
}

function fastLaneFixProofMethod(root: string, sessionId: string): RaiseFixProofMethodResult | null {
  const dirName = currentFeature(root, sessionId);
  if (!dirName || readChangeConstants(root, dirName).lane !== 'fast') return null;
  return raiseFixProofMethodDecision(root, dirName);
}

export function readinessLine(id: string, deferred: boolean): string {
  if (deferred) {
    return (
      `**▸ paqad** · Visual evidence is on, but I can't capture screenshots here yet. I raised ${id} ` +
      `and will ask it with the rest of this change's questions at the spec questions step. Keep going.`
    );
  }
  return (
    `**▸ paqad** · Visual evidence is on, but I can't capture screenshots here yet. Answer ${id} ` +
    `(\`paqad-ai decision resolve ${id} setup|attach|waive\`), then I'll continue.`
  );
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
      const activeDir = currentFeature(root, sessionId);
      const changedFiles = (
        await loadChangeEvidence(root, {
          since: activeDir ? readChangeStartPoint(root, activeDir) : null,
        })
      ).files;
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
      const proofMethod = fastLaneFixProofMethod(root, sessionId);
      if (proofMethod?.raised) {
        console.warn(fixProofMethodLine(proofMethod.id));
      }
      if (result.readinessDecision) {
        console.warn(
          readinessLine(result.readinessDecision, questionRoundAhead(root, result.dirName)),
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
          ...(proofMethod ? { fix_proof_method: proofMethod.id } : {}),
        }),
      );
    });

  return command;
}
