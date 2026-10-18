import { Command } from 'commander';

import {
  ROUTED_WORKFLOWS,
  isFeatureDevelopmentRoute,
  type RoutedWorkflow,
} from '@/pipeline/routed-workflow.js';
import { appendRouteOverride } from '@/pipeline/route-override-log.js';
import { editedDevelopmentThisTurn } from '@/pipeline/session-ownership.js';
import { readSessionRoute, writeSessionRoute } from '@/pipeline/session-route.js';
import { readWorkflowState, writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { clearPendingLane } from '@/stage-evidence/pending-lane.js';

interface RouteSetOptions {
  projectRoot: string;
  session?: string;
  reason?: string;
}

function isRoutedWorkflow(value: string): value is RoutedWorkflow {
  return (ROUTED_WORKFLOWS as readonly string[]).includes(value);
}

/** The audit reason recorded when no session id was given (issue #623 FR-6). */
export const UNRESOLVED_SESSION_REASON =
  'session could not be resolved (no --session, SE_SESSION or CLAUDE_SESSION_ID), so the edited-this-turn check was skipped';

/**
 * The session id the caller named: `--session`, then `SE_SESSION`, then `CLAUDE_SESSION_ID`,
 * skipping blank values. Null when none was given, so the caller can tell an explicit session
 * from the shared cache file's guess.
 */
function explicitSessionHint(option: string | undefined): string | null {
  for (const candidate of [option, process.env.SE_SESSION, process.env.CLAUDE_SESSION_ID]) {
    const cleaned = candidate?.trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return null;
}

/**
 * `paqad-ai route set <workflow> [--reason]` — correct the route the hook's deterministic
 * classifier picked (issue #580). The agent routes by intent (AGENT-ROUTER.md); when the
 * `**▸ paqad** · routed to …` line names a different workflow than the one the agent picked, this
 * verb rewrites the ACTIVE per-session route to the agent's pick.
 *
 * It rewrites the active workflow-state entry (it does NOT push a pause), updates the
 * `.session-route.json` pointer, clears any lane the hook stashed when the new route is not
 * feature-development, and appends an `agent-override` audit row. It refuses to LEAVE
 * feature-development once THIS session has edited source files this turn (issue #623: its own
 * `development` rows, never the shared git tree, so another session in the same checkout cannot
 * block the correction). When no session id was given at all, the correction is allowed and the
 * audit row says why the check was skipped.
 */
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
      const hookLabel = current ?? readSessionRoute(root, sessionId)?.workflow ?? null;

      // AC-5 — a change already under way cannot be downgraded out of feature-development once
      // this session has edited source files this turn. The edit made it a real change; keep it
      // governed. With no session named, the cached id may be another session's, so the check is
      // skipped: being stuck on a wrong label is worse than an honest, logged correction.
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

      // Rewrite the ACTIVE entry in place (not a pause). The paused stack is untouched, so a
      // real feature-development change paused behind a question still resumes later.
      writeWorkflowState(root, sessionId, {
        ...state,
        active: { workflow: target },
      });

      // Keep the detached context worker's pointer in step; preserve its query/adapter.
      const priorRoute = readSessionRoute(root, sessionId);
      writeSessionRoute(
        root,
        {
          workflow: target,
          query: priorRoute?.query ?? '',
          ...(priorRoute?.adapter === undefined ? {} : { adapter: priorRoute.adapter }),
        },
        sessionId,
      );

      // A lane the hook stashed for a feature-development label must not leak onto a later
      // change once the route is corrected to a non-feature workflow.
      if (!isFeatureDevelopmentRoute(target)) {
        clearPendingLane(root, sessionId);
      }

      const reasons = [
        options.reason,
        hint === null ? UNRESOLVED_SESSION_REASON : undefined,
      ].filter((part): part is string => part !== undefined);
      appendRouteOverride(root, sessionId, {
        hookLabel,
        agentLabel: target,
        ...(reasons.length === 0 ? {} : { reason: reasons.join('; ') }),
      });

      console.log(`**▸ paqad** · route set to ${target}`);
      console.log(JSON.stringify({ routed: target, was: hookLabel, source: 'agent-override' }));
    });

  return command;
}
