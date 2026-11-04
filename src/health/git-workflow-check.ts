import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { HealthCheckResult } from '@/core/types/health.js';
import {
  resolveHooksDir,
  trackedWorkflowHookAdvice,
  workflowHooksInstalled,
} from '@/feature-evidence/git-hooks.js';
import { changedOutside } from '@/git-workflow/last-applied.js';
import { gitWorkflowDir, loadGitWorkflow } from '@/git-workflow/load.js';
import { OLD_DELIVERY_POLICY } from '@/git-workflow/migrate.js';

export const GIT_WORKFLOW_CHECK = 'git-workflow';

const SKILL_REVIEW = 'Ask your agent to review it with the git-workflow skill.';

function warning(detail: string, remediation: string): HealthCheckResult {
  return { name: GIT_WORKFLOW_CHECK, status: 'warning', detail, remediation };
}

export function gitWorkflowHealth(
  projectRoot: string,
  hooksInstalled: (root: string) => boolean = workflowHooksInstalled,
): HealthCheckResult[] {
  if (!existsSync(gitWorkflowDir(projectRoot))) {
    return [
      warning(
        `${PATHS.GIT_WORKFLOW_DIR}/ is missing. Run paqad-ai update to create it.`,
        'Run paqad-ai update.',
      ),
    ];
  }

  const results: HealthCheckResult[] = [];
  const loaded = loadGitWorkflow(projectRoot);
  for (const error of loaded.errors) {
    results.push(warning(`git-workflow: ${error.message}`, SKILL_REVIEW));
  }
  for (const unknown of loaded.warnings) {
    results.push(warning(unknown.message, SKILL_REVIEW));
  }

  if (existsSync(join(projectRoot, OLD_DELIVERY_POLICY))) {
    results.push(
      warning(
        `${OLD_DELIVERY_POLICY} is no longer read. Delete it.`,
        `Delete ${OLD_DELIVERY_POLICY}.`,
      ),
    );
  }

  const { tickets, enforcement } = loaded.config;
  if (tickets.write_back_refined !== 'ask') {
    results.push(
      warning(
        'git-workflow: write_back_refined is set but not applied yet.',
        'Leave write_back_refined at ask until paqad applies it.',
      ),
    );
  }

  if (
    enforcement.enabled &&
    enforcement.people !== 'off' &&
    resolveHooksDir(projectRoot) !== null &&
    !hooksInstalled(projectRoot)
  ) {
    const advice = trackedWorkflowHookAdvice(projectRoot);
    results.push(
      advice === null
        ? warning(
            `git-workflow: people is set to ${enforcement.people} but the commit-msg and pre-push hooks aren't installed. Run paqad-ai update.`,
            'Run paqad-ai update.',
          )
        : warning(advice, 'Add the lines above by hand, then run paqad-ai doctor again.'),
    );
  }

  for (const file of changedOutside(projectRoot)) {
    results.push(
      warning(
        `git-workflow: ${file} was changed outside the git-workflow skill. ${SKILL_REVIEW}`,
        SKILL_REVIEW,
      ),
    );
  }

  if (results.length > 0) return results;
  return [
    {
      name: GIT_WORKFLOW_CHECK,
      status: 'pass',
      detail: `${PATHS.GIT_WORKFLOW_DIR}/ is valid and every file was applied through the git-workflow skill.`,
    },
  ];
}
