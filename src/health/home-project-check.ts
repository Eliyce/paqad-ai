import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { HealthCheckResult } from '@/core/types/health.js';

export const HOME_PROJECT_CHECK = 'Home folder project';

export const HOME_PROJECT_WARNING =
  'Your home folder is set up as a paqad project. This makes the HUD pick the wrong folder. Remove ~/.paqad/framework-path.txt unless you really work in your home folder.';

export function homeProjectHealth(homeDir: string = homedir()): HealthCheckResult[] {
  if (existsSync(join(homeDir, '.paqad', 'framework-path.txt'))) {
    return [
      {
        name: HOME_PROJECT_CHECK,
        status: 'warning',
        detail: HOME_PROJECT_WARNING,
        remediation: 'Remove ~/.paqad/framework-path.txt by hand; paqad never deletes it.',
      },
    ];
  }
  return [
    {
      name: HOME_PROJECT_CHECK,
      status: 'pass',
      detail: 'Your home folder is not set up as a paqad project.',
    },
  ];
}
