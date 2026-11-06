import { Command } from 'commander';

import {
  ROUTED_WORKFLOWS,
  isFeatureDevelopmentRoute,
  type RoutedWorkflow,
} from '@/pipeline/routed-workflow.js';
import { writeRouteCorrection } from '@/pipeline/route-switch.js';
import { editedDevelopmentThisTurn } from '@/pipeline/session-ownership.js';
import { readWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

interface RouteSetOptions {
  projectRoot: string;
  session?: string;
  reason?: string;
}

function isRoutedWorkflow(value: string): value is RoutedWorkflow {
  return (ROUTED_WORKFLOWS as readonly string[]).includes(value);
}

export const UNRESOLVED_SESSION_REASON =
  'session could not be resolved (no --session, SE_SESSION or CLAUDE_SESSION_ID), so the edited-this-turn check was skipped';

function explicitSessionHint(option: string | undefined): string | null {
  for (const candidate of [option, process.env.SE_SESSION, process.env.CLAUDE_SESSION_ID]) {
    const cleaned = candidate?.trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return null;
}

export function createRouteCommand(): Command {
  const command = new Command('route').description(
    "Correct the route the prompt hook picked (agent's intent wins)",
  );

  command
    .command('set')
    .description('Set the active route for this session to <workflow>')
    .argument('<workflow>', `Target route (one of: ${ROUTED_WORKFLOWS.join(', ')})`)
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .option('--reason <text>', 'Why the hook label was wrong (recorded in the audit row)')
    .action((workflow: string, options: RouteSetOptions) => {
      if (!isRoutedWorkflow(workflow)) {
        console.error(
          `unknown workflow "${workflow}" — expected one of: ${ROUTED_WORKFLOWS.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      const target: RoutedWorkflow = workflow;
      const root = options.projectRoot;
      const hint = explicitSessionHint(options.session);
      const sessionId = resolveSessionId(root, hint);

      const state = readWorkflowState(root, sessionId);
      const current = state.active?.workflow ?? null;

      if (
        hint !== null &&
        current === 'feature-development' &&
        !isFeatureDevelopmentRoute(target) &&
        editedDevelopmentThisTurn(root, sessionId)
      ) {
        console.error(
          `cannot leave feature-development: source files were edited this turn. ` +
            `Finish or revert the change first.`,
        );
        process.exitCode = 1;
        return;
      }

      const reasons = [
        options.reason,
        hint === null ? UNRESOLVED_SESSION_REASON : undefined,
      ].filter((part): part is string => part !== undefined);
      const hookLabel = writeRouteCorrection(root, sessionId, target, {
        ...(reasons.length === 0 ? {} : { reason: reasons.join('; ') }),
      });

      console.log(`**▸ paqad** · route set to ${target}`);
      console.log(JSON.stringify({ routed: target, was: hookLabel, source: 'agent-override' }));
    });

  return command;
}
