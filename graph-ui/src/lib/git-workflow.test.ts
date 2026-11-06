import { describe, expect, it } from 'vitest';

import { changedOutsideMessage, GIT_WORKFLOW_TABS, issuesForFile, tabStatus } from './git-workflow';

const error = { file: 'branches.yaml', path: 'types', message: 'bad' };
const warning = { file: 'commits.yaml', path: 'colour', message: 'unknown' };

describe('git-workflow tabs', () => {
  it('has one tab per file in the loader order', () => {
    expect(GIT_WORKFLOW_TABS.map((tab) => tab.name)).toEqual([
      'tickets.yaml',
      'branches.yaml',
      'commits.yaml',
      'pull-requests.yaml',
      'enforcement.yaml',
      'design-sign-off.yaml',
    ]);
  });

  it('keeps only the issues for one file', () => {
    expect(issuesForFile([error, warning], 'branches.yaml')).toEqual([error]);
    expect(issuesForFile([error, warning], 'tickets.yaml')).toEqual([]);
  });

  it('ranks errors over warnings over a hand edit', () => {
    const state = {
      errors: [error],
      warnings: [warning],
      changedOutside: ['enforcement.yaml' as const],
    };
    expect(tabStatus('branches.yaml', state)).toBe('error');
    expect(tabStatus('commits.yaml', state)).toBe('warning');
    expect(tabStatus('enforcement.yaml', state)).toBe('changed-outside');
    expect(tabStatus('tickets.yaml', state)).toBe('ok');
  });

  it('words the hand-edit notice like doctor does', () => {
    expect(changedOutsideMessage('tickets.yaml')).toBe(
      'tickets.yaml was changed outside the git-workflow skill. Ask your agent to review it with the git-workflow skill.',
    );
  });
});
