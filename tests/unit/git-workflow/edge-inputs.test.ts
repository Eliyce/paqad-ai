import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { defaultGitWorkflow } from '@/git-workflow/defaults.js';
import { resolveGitWorkflow } from '@/git-workflow/load.js';
import { templateToRegExp, ticketPatterns } from '@/git-workflow/patterns.js';
import { summaryPart } from '@/git-workflow/summary-style.js';
import { syncGitWorkflow } from '@/git-workflow/sync.js';

const jira = {
  tracker: 'jira' as const,
  pattern: 'PROJ-\\d+',
  server: '',
  transitions: { on_pr_open: '', on_ci_green: '' },
};

describe('git-workflow: files that are not settings', () => {
  it('reports a file that holds a list instead of settings', () => {
    const result = resolveGitWorkflow({ 'commits.yaml': '- a\n- b\n' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      file: 'commits.yaml',
      path: '',
      message: 'commits.yaml must hold settings, not a list or a value.',
    });
  });

  it('leaves a broken file alone when syncing and still fills in the missing ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-wf-sync-edge-'));
    try {
      const dir = join(root, PATHS.GIT_WORKFLOW_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'commits.yaml'), 'template: [unclosed\n');
      const written = syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'main' });
      expect(written.map((path) => path.split(/[\\/]/).pop())).toEqual([
        'tickets.yaml',
        'branches.yaml',
        'pull-requests.yaml',
        'enforcement.yaml',
      ]);
      expect(readFileSync(join(dir, 'commits.yaml'), 'utf8')).toBe('template: [unclosed\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('git-workflow patterns without types or tickets', () => {
  it('falls back to any word, prefix and ticket when nothing is configured', () => {
    const config = defaultGitWorkflow();
    config.branches.types = {};
    const matcher = templateToRegExp('{type}: {summary}', config);
    expect(matcher.test('chore: tidy up')).toBe(true);
    const branch = templateToRegExp('{prefix}/{ticket}-{title_slug}', config, { branch: true });
    expect(branch.test('misc/ANY-thing-x')).toBe(true);
  });

  it('drops the leading hash from GitHub patterns for branch names and skips empty patterns', () => {
    const config = defaultGitWorkflow();
    config.tickets.sources = {
      gh: { ...jira, tracker: 'github-issues', pattern: '#\\d+' },
      none: { ...jira, pattern: '' },
    };
    expect(ticketPatterns(config, true)).toEqual(['\\d+']);
    expect(ticketPatterns(config)).toEqual(['#\\d+']);
  });

  it('reads the summary with any word as the type and skips a ticket pattern that does not compile', () => {
    const config = defaultGitWorkflow();
    config.branches.types = {};
    config.tickets.sources = { bad: { ...jira, pattern: '(' }, proj: jira };
    expect(summaryPart('chore: tidy the list', '{type}: {summary}', config)).toBe('tidy the list');
    expect(summaryPart('no template here PROJ-1', '{ticket}', config)).toBe('no template here');
  });
});
