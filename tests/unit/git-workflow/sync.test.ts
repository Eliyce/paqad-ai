import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { readLastApplied } from '@/git-workflow/last-applied.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { syncGitWorkflow, syncGitWorkflowFile } from '@/git-workflow/sync.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';

const OPTS = { version: '2.0.0', baseBranch: 'main' };

describe('syncGitWorkflowFile', () => {
  it('leaves a complete file byte-identical', () => {
    for (const file of GIT_WORKFLOW_FILES) {
      const text = renderDefaultGitWorkflowFile(file, { version: '1.0.0' });
      expect(syncGitWorkflowFile(text, file, OPTS)).toBe(text);
    }
  });

  it('adds a missing fixed-place key with its default, the Added line and a bumped version', () => {
    const text = [
      '# How pull requests are opened.',
      'paqad_version: "1.0.0"',
      '',
      'title_template: "{ticket}: {summary}"  # team value',
      'body_template: .github/pull_request_template.md',
      'draft: true',
      'reviewers: [alice]',
      'labels: []',
      'link_ticket: false',
      'also_open_against: [qa]',
      'host: github',
      'host_server: ""',
      '',
      'ci:',
      '  gate: warn_only   # keep this comment',
      '  on_red: stop',
      '',
    ].join('\n');
    const next = syncGitWorkflowFile(text, 'pull-requests.yaml', OPTS);
    expect(next).toBe(
      [
        '# How pull requests are opened.',
        'paqad_version: "2.0.0"',
        '',
        'title_template: "{ticket}: {summary}"  # team value',
        'body_template: .github/pull_request_template.md',
        'draft: true',
        'reviewers: [alice]',
        'labels: []',
        'link_ticket: false',
        'also_open_against: [qa]',
        'host: github',
        'host_server: ""',
        '',
        'ci:',
        '  gate: warn_only   # keep this comment',
        '  on_red: stop',
        '  # Added in paqad-ai 2.0.0',
        '  timeout_minutes: 30',
        '',
      ].join('\n'),
    );
  });

  it('appends a missing top-level key at the end of the file', () => {
    const text = 'paqad_version: "1.0.0"\n\nenabled: true\nagents: warn\n';
    expect(syncGitWorkflowFile(text, 'enforcement.yaml', OPTS)).toBe(
      'paqad_version: "2.0.0"\n\nenabled: true\nagents: warn\n\n# Added in paqad-ai 2.0.0\npeople: warn\n',
    );
  });

  it('never inserts a key into a team-named branch type or ticket source', () => {
    const text = [
      'paqad_version: "1.0.0"',
      'base_branch: main',
      'template: "{prefix}/{ticket}-{title_slug}"',
      'slug_max_length: 50',
      'types:',
      '  bugfix:',
      '    prefix: bug',
      'default_type: bugfix',
      '',
    ].join('\n');
    expect(syncGitWorkflowFile(text, 'branches.yaml', OPTS)).toBe(text);
    const tickets = renderDefaultGitWorkflowFile('tickets.yaml', { version: '1.0.0' }).replace(
      'sources: {}',
      'sources:\n  proj:\n    tracker: jira',
    );
    expect(syncGitWorkflowFile(tickets, 'tickets.yaml', OPTS)).toBe(tickets);
  });

  it('never touches a file whose paqad_version is newer than the running package', () => {
    const text = 'paqad_version: "3.0.0"\nenabled: true\n';
    expect(syncGitWorkflowFile(text, 'enforcement.yaml', OPTS)).toBe(text);
  });
});

describe('syncGitWorkflow', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'git-workflow-sync-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes a missing file whole, then stamps .last-applied.json for the files it changed', () => {
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    const enforcement = join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml');
    writeFileSync(enforcement, 'paqad_version: "1.0.0"\nenabled: true\nagents: warn\n');
    const written = syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'develop' });
    expect(written).toHaveLength(5);
    expect(readFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'branches.yaml'), 'utf8')).toContain(
      '\nbase_branch: develop\n',
    );
    expect(readFileSync(enforcement, 'utf8')).toContain('# Added in paqad-ai 2.0.0\npeople: warn');
    expect(Object.keys(readLastApplied(root)?.files ?? {})).toHaveLength(5);
    expect(loadGitWorkflow(root).config.enforcement.agents).toBe('warn');
    expect(syncGitWorkflow(root, { version: '2.0.0' })).toEqual([]);
  });
});
