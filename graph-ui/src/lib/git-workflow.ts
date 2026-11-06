import type { GitWorkflowFileName, GitWorkflowIssue } from './dashboard-types';

export interface GitWorkflowTab {
  name: GitWorkflowFileName;
  label: string;
  what: string;
}

export const GIT_WORKFLOW_TABS: readonly GitWorkflowTab[] = [
  {
    name: 'tickets.yaml',
    label: 'Tickets',
    what: "Where this team's tickets come from and how they move.",
  },
  {
    name: 'branches.yaml',
    label: 'Branches',
    what: 'How branches are named and where changes start.',
  },
  { name: 'commits.yaml', label: 'Commits', what: 'How commit messages are written.' },
  {
    name: 'pull-requests.yaml',
    label: 'Pull requests',
    what: 'How pull requests are opened.',
  },
  {
    name: 'enforcement.yaml',
    label: 'Enforcement',
    what: 'How strictly paqad holds everyone to these rules.',
  },
  {
    name: 'design-sign-off.yaml',
    label: 'Design sign-off',
    what: 'A short design of each change for the team to sign off before the build starts.',
  },
];

export function issuesForFile(
  issues: readonly GitWorkflowIssue[],
  file: GitWorkflowFileName,
): GitWorkflowIssue[] {
  return issues.filter((issue) => issue.file === file);
}

export type GitWorkflowTabStatus = 'error' | 'warning' | 'changed-outside' | 'ok';

export function tabStatus(
  file: GitWorkflowFileName,
  state: {
    errors: readonly GitWorkflowIssue[];
    warnings: readonly GitWorkflowIssue[];
    changedOutside: readonly GitWorkflowFileName[];
  },
): GitWorkflowTabStatus {
  if (issuesForFile(state.errors, file).length > 0) return 'error';
  if (issuesForFile(state.warnings, file).length > 0) return 'warning';
  if (state.changedOutside.includes(file)) return 'changed-outside';
  return 'ok';
}

export function changedOutsideMessage(file: GitWorkflowFileName): string {
  return `${file} was changed outside the git-workflow skill. Ask your agent to review it with the git-workflow skill.`;
}
