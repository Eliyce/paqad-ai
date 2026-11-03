import { execFileSync } from 'node:child_process';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';

import { DEFAULT_BASE_BRANCH, renderDefaultGitWorkflowFile } from './defaults.js';
import { GIT_WORKFLOW_FILES } from './types.js';

export const DEFAULT_PR_BODY = `## Summary

{summary}

## Ticket

{ticket}

## Test plan

- [ ] Unit / integration tests pass locally
- [ ] Manual verification on the affected surface
- [ ] Docs and registries updated

🤖 Generated with paqad-ai delivery
`;

export function remoteDefaultBranch(projectRoot: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const branch = ref.replace(/^origin\//, '');
    return branch === '' ? DEFAULT_BASE_BRANCH : branch;
  } catch {
    return DEFAULT_BASE_BRANCH;
  }
}

export function generateGitWorkflowFiles(
  domain: 'coding' | 'content',
  projectRoot: string,
): GeneratedFile[] {
  if (domain !== 'coding') {
    return [];
  }
  const baseBranch = remoteDefaultBranch(projectRoot);
  return [
    ...GIT_WORKFLOW_FILES.map((file) => ({
      path: `${PATHS.GIT_WORKFLOW_DIR}/${file}`,
      content: renderDefaultGitWorkflowFile(file, { baseBranch }),
      autoUpdate: false,
    })),
    {
      path: PATHS.DELIVERY_PR_BODY_TEMPLATE,
      content: DEFAULT_PR_BODY,
      autoUpdate: false,
    },
  ];
}
