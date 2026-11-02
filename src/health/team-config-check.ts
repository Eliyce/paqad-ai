import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { HealthCheckResult } from '@/core/types/health.js';
import { readTeamConfig } from '@/core/team-config.js';
import {
  legacyFilesWithSettings,
  legacyShouldMoveLine,
  releasedAfterLegacyWindow,
} from '@/core/team-config-legacy.js';
import {
  missingTeamConfigFiles,
  missingTeamFileLine,
  unknownSettingLine,
  unknownTeamConfigSettings,
} from '@/core/team-config-report.js';
import {
  FEATURE_DEVELOPMENT_VIEW_RELATIVE,
  viewEditedByHand,
} from '@/pipeline/feature-development-view.js';

export const TEAM_CONFIG_CHECK = 'team-config';

const MIGRATE = 'Run paqad-ai config migrate.';

export function viewEditedByHandLine(): string {
  return `${FEATURE_DEVELOPMENT_VIEW_RELATIVE} was edited by hand. Changes go in .paqad/configs/feature-development/; it is regenerated on the next session.`;
}

function result(
  status: 'warning' | 'fail',
  detail: string,
  remediation: string,
): HealthCheckResult {
  return { name: TEAM_CONFIG_CHECK, status, detail, remediation };
}

export function teamConfigHealth(projectRoot: string): HealthCheckResult[] {
  if (!existsSync(join(projectRoot, PATHS.PROJECT_CONFIGS_DIR))) return [];
  const results: HealthCheckResult[] = [];
  for (const file of missingTeamConfigFiles(projectRoot)) {
    results.push(result('warning', missingTeamFileLine(file), 'Run paqad-ai update.'));
  }
  for (const issue of readTeamConfig(projectRoot).issues) {
    if (issue.kind === 'legacy') continue;
    results.push(
      result(
        'warning',
        issue.message,
        `Fix .paqad/configs/${issue.file} or run paqad-ai config show.`,
      ),
    );
  }
  for (const { file, path } of unknownTeamConfigSettings(projectRoot)) {
    results.push(
      result('warning', unknownSettingLine(file, path), `Check ${path} in .paqad/configs/${file}.`),
    );
  }
  const legacyStatus = releasedAfterLegacyWindow() ? 'fail' : 'warning';
  for (const file of legacyFilesWithSettings(projectRoot)) {
    results.push(result(legacyStatus, legacyShouldMoveLine(file), MIGRATE));
  }
  if (viewEditedByHand(projectRoot)) {
    results.push(
      result(
        'warning',
        viewEditedByHandLine(),
        'Move the edit to .paqad/configs/feature-development/ and start a new session.',
      ),
    );
  }
  if (results.length > 0) return results;
  return [
    {
      name: TEAM_CONFIG_CHECK,
      status: 'pass',
      detail: 'The team settings in .paqad/configs/ are valid.',
    },
  ];
}
